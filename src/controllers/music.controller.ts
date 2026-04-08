import { Request, Response } from "express";
import mongoose from "mongoose";
import { GridFSBucket } from "mongodb";
import { Readable } from "stream";

// Hàm hỗ trợ lấy Bucket (tránh lặp code)
const getBucket = () => {
  const db = mongoose.connection.db;
  if (!db) throw new Error("Database chưa sẵn sàng!");
  return new GridFSBucket(db, { bucketName: "mp3" });
};

// [POST] Upload Nhạc (THÊM)
// [POST] Upload Nhạc + Ảnh + Thông tin (THÊM)
export const uploadMusic = async (req: Request, res: Response) => {
  try {
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    const { name, author } = req.body; // Lấy tên bài hát và tác giả từ body

    if (!files || !files.mp3) {
      return res.status(400).json({ message: "Thiếu file nhạc MP3." });
    }

    const db = mongoose.connection.db!;
    const musicBucket = new GridFSBucket(db, { bucketName: "mp3" });
    const imageBucket = new GridFSBucket(db, { bucketName: "images" });

    // 1. Xử lý lưu Ảnh (nếu có)
    let imageId = null;
    if (files.img && files.img[0]) {
      const imgFile = files.img[0];
      const imgFilename = Date.now() + "-" + imgFile.originalname;
      const imgUploadStream = imageBucket.openUploadStream(imgFilename, {
        contentType: imgFile.mimetype,
      });

      const imgReadable = new Readable();
      imgReadable.push(imgFile.buffer);
      imgReadable.push(null);
      imgReadable.pipe(imgUploadStream);

      imageId = imgUploadStream.id; // Lấy ID của ảnh để liên kết
    }

    // 2. Xử lý lưu Nhạc
    const musicFile = files.mp3[0];
    const musicFilename = Date.now() + "-" + musicFile.originalname;

    const musicUploadStream = musicBucket.openUploadStream(musicFilename, {
      contentType: musicFile.mimetype,
      metadata: {
        title: name || musicFile.originalname, // Tên bài hát
        artist: author || "Unknown", // Tác giả
        coverImageId: imageId, // Link tới ID ảnh trong bucket images
      },
    });

    const musicReadable = new Readable();
    musicReadable.push(musicFile.buffer);
    musicReadable.push(null);

    musicReadable
      .pipe(musicUploadStream)
      .on("error", (error) =>
        res.status(500).json({ message: "Lỗi lưu database", error }),
      )
      .on("finish", () => {
        res.json({
          message: "Upload thành công!",
          data: {
            id: musicUploadStream.id,
            title: name,
            artist: author,
            musicFile: musicFilename,
            hasImage: !!imageId,
          },
        });
      });
  } catch (error) {
    res.status(500).json({ message: "Lỗi server", error });
  }
};

// [GET] Xem ảnh bìa (STREAM IMAGE)
export const streamImage = (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "ID ảnh không hợp lệ" });
    }

    const db = mongoose.connection.db!;
    const bucket = new GridFSBucket(db, { bucketName: "images" });

    // Tạo luồng tải file bằng ID
    const stream = bucket.openDownloadStream(new mongoose.Types.ObjectId(id));

    // Thiết lập Header để trình duyệt hiểu đây là hình ảnh
    // Lưu ý: Nếu bạn lưu nhiều loại ảnh, có thể cần lấy contentType từ DB
    res.set("Content-Type", "image/jpeg");

    stream.on("error", () => {
      res.status(404).json({ message: "Không tìm thấy ảnh" });
    });

    stream.pipe(res);
  } catch (error) {
    res.status(500).json({ message: "Lỗi server", error });
  }
};
// [GET] Lấy danh sách nhạc (LẤY ALL)
export const getAllMusic = async (req: Request, res: Response) => {
  try {
    const bucket = getBucket();
    const files = await bucket.find({}).toArray();

    if (!files || files.length === 0) {
      return res.status(200).json({ message: "Chưa có nhạc", files: [] });
    }

    const formattedFiles = files.map((file) => ({
      id: file._id,
      filename: file.filename,
      size: (file.length / (1024 * 1024)).toFixed(2) + " MB",
      uploadDate: file.uploadDate,
      metadata: file.metadata || {}, // Lấy thêm metadata nếu có
      streamUrl: `./api/music/stream/${file.filename}`,
    }));

    res.status(200).json({
      message: "Thành công",
      total: formattedFiles.length,
      files: formattedFiles,
    });
  } catch (error) {
    res.status(500).json({ message: "Lỗi server", error });
  }
};

// [GET] Stream nhạc (NGHE NHẠC)
export const streamMusic = (req: Request, res: Response) => {
  try {
    const name = req.params.name as string;

    if (!name)
      return res.status(400).json({ message: "Tên file không hợp lệ" });

    const bucket = getBucket();
    const stream = bucket.openDownloadStreamByName(name);

    res.set("Content-Type", "audio/mpeg");
    res.set("Accept-Ranges", "bytes");

    stream.on("error", () =>
      res.status(404).json({ message: "File không tồn tại" }),
    );
    stream.pipe(res);
  } catch (error) {
    res.status(500).json({ message: "Lỗi server", error });
  }
};

// [PATCH] Sửa thông tin bài nhạc (SỬA)
export const updateMusic = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updateFields = req.body;

    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ message: "ID không hợp lệ" });

    delete updateFields._id;
    delete updateFields.length;
    delete updateFields.chunkSize;
    delete updateFields.uploadDate;

    if (Object.keys(updateFields).length === 0)
      return res.status(400).json({ message: "Không có dữ liệu update" });

    const collection = mongoose.connection.db!.collection("mp3.files");
    const $set: any = {};

    for (const key in updateFields) {
      if (key === "filename") $set.filename = updateFields[key];
      else $set[`metadata.${key}`] = updateFields[key];
    }

    const result = await collection.updateOne(
      { _id: new mongoose.Types.ObjectId(id) },
      { $set },
    );

    if (result.matchedCount === 0)
      return res.status(404).json({ message: "Không tìm thấy bài nhạc" });

    res
      .status(200)
      .json({ message: "Cập nhật thành công!", updatedFields: $set });
  } catch (error) {
    res.status(500).json({ message: "Lỗi server", error });
  }
};

// [DELETE] Xóa bài nhạc (XÓA)
export const deleteMusic = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ message: "ID không hợp lệ" });

    const bucket = getBucket();

    // Gọi hàm delete của GridFSBucket (nó sẽ xóa cả metadata trong mp3.files và dữ liệu âm thanh trong mp3.chunks)
    await bucket.delete(new mongoose.Types.ObjectId(id));

    res.status(200).json({ message: "Đã xóa bài nhạc thành công" });
  } catch (error: any) {
    if (error.message.includes("FileNotFound")) {
      return res.status(404).json({ message: "Không tìm thấy file để xóa" });
    }
    res.status(500).json({ message: "Lỗi server", error });
  }
};

// [PUT] Thay thế file âm thanh của bài nhạc (GIỮ NGUYÊN ID)
export const replaceMusicFile = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "ID không hợp lệ" });
    }
    if (!req.file) {
      return res
        .status(400)
        .json({ message: "Vui lòng chọn file MP3 mới để thay thế." });
    }

    const bucket = getBucket();
    const objectId = new mongoose.Types.ObjectId(id);

    // 1. Kiểm tra xem bài nhạc cũ có tồn tại không
    const files = await bucket.find({ _id: objectId }).toArray();
    if (files.length === 0) {
      return res
        .status(404)
        .json({ message: "Không tìm thấy bài nhạc để thay thế" });
    }

    // 2. Xóa file âm thanh cũ
    await bucket.delete(objectId);

    // 3. Upload file mới, nhưng ÉP dùng lại ID cũ
    const filename = Date.now() + "-" + req.file.originalname;
    const uploadStream = bucket.openUploadStream(filename, {
      id: objectId, // Khúc này cực kỳ quan trọng: Giữ lại ID cũ
      metadata: { contentType: req.file.mimetype },
    });

    const readableStream = new Readable();
    readableStream.push(req.file.buffer);
    readableStream.push(null);

    readableStream
      .pipe(uploadStream)
      .on("error", (error) =>
        res.status(500).json({ message: "Lỗi lưu database", error }),
      )
      .on("finish", () =>
        res.json({
          message: "Thay thế file nhạc thành công!",
          id: objectId,
          newFilename: filename,
        }),
      );
  } catch (error) {
    res.status(500).json({ message: "Lỗi server", error });
  }
};
