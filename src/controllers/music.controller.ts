import { Request, Response } from "express";
import mongoose from "mongoose";
import { GridFSBucket } from "mongodb";
import { Readable } from "stream";

// Hàm hỗ trợ lấy Bucket (tránh lặp code)
const getBucket = (bucketName: string = "mp3") => {
  const db = mongoose.connection.db;
  if (!db) throw new Error("Database chưa sẵn sàng!");
  return new GridFSBucket(db, { bucketName });
};

// [POST] Upload Nhạc + Ảnh
export const uploadMusic = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    const name = req.body.name as string;
    const author = req.body.author as string;

    // Ép kiểu rõ ràng và kiểm tra an toàn 100%
    if (!files || !files.mp3 || !files.mp3[0]) {
      res.status(400).json({ message: "Thiếu file nhạc MP3." });
      return;
    }

    const musicBucket = getBucket("mp3");
    const imageBucket = getBucket("images");

    let imageId: any = null;

    // 1. Xử lý lưu Ảnh (nếu có)
    if (files.img && files.img[0]) {
      const imgFile = files.img[0] as Express.Multer.File;
      const imgFilename = Date.now() + "-" + imgFile.originalname;

      // Đưa contentType vào trong metadata theo chuẩn MongoDB mới
      const imgUploadStream = imageBucket.openUploadStream(imgFilename, {
        metadata: { contentType: imgFile.mimetype },
      });

      const imgReadable = new Readable();
      imgReadable.push(imgFile.buffer);
      imgReadable.push(null);
      imgReadable.pipe(imgUploadStream);

      imageId = imgUploadStream.id;
    }

    // 2. Xử lý lưu Nhạc
    const musicFile = files.mp3[0] as Express.Multer.File;
    const musicFilename = Date.now() + "-" + musicFile.originalname;

    const musicUploadStream = musicBucket.openUploadStream(musicFilename, {
      metadata: {
        contentType: musicFile.mimetype, // Đưa vào đây
        title: name || musicFile.originalname,
        artist: author || "Unknown",
        coverImageId: imageId,
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

// [GET] Lấy danh sách nhạc (LẤY ALL)
export const getAllMusic = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const bucket = getBucket("mp3");
    const files = await bucket.find({}).toArray();

    if (!files || files.length === 0) {
      res.status(200).json({ message: "Chưa có nhạc", files: [] });
      return;
    }

    // Lấy động đường dẫn (host) để Render tự hiểu domain của nó, không bị fix cứng localhost nữa
    const baseUrl = `${req.protocol}://${req.get("host")}/api/music`;

    const formattedFiles = files.map((file) => ({
      id: file._id,
      filename: file.filename,
      size: (file.length / (1024 * 1024)).toFixed(2) + " MB",
      uploadDate: file.uploadDate,
      title: file.metadata?.title || "No Title",
      artist: file.metadata?.artist || "Unknown",
      coverUrl: file.metadata?.coverImageId
        ? `${baseUrl}/image/${file.metadata.coverImageId}`
        : null,
      streamUrl: `${baseUrl}/stream/${file.filename}`,
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
export const streamMusic = (req: Request, res: Response): void => {
  try {
    const filename = String(req.params.name); // Ép kiểu về String
    const bucket = getBucket("mp3");
    const stream = bucket.openDownloadStreamByName(filename);

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
export const updateMusic = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const id = String(req.params.id);
    const updateFields = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ message: "ID không hợp lệ" });
      return;
    }

    delete updateFields._id;
    delete updateFields.length;
    delete updateFields.chunkSize;
    delete updateFields.uploadDate;

    if (Object.keys(updateFields).length === 0) {
      res.status(400).json({ message: "Không có dữ liệu update" });
      return;
    }

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

    if (result.matchedCount === 0) {
      res.status(404).json({ message: "Không tìm thấy bài nhạc" });
      return;
    }

    res
      .status(200)
      .json({ message: "Cập nhật thành công!", updatedFields: $set });
  } catch (error) {
    res.status(500).json({ message: "Lỗi server", error });
  }
};

// [DELETE] Xóa bài nhạc (XÓA)
export const deleteMusic = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const id = String(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ message: "ID không hợp lệ" });
      return;
    }

    const bucket = getBucket("mp3");
    await bucket.delete(new mongoose.Types.ObjectId(id));

    res.status(200).json({ message: "Đã xóa bài nhạc thành công" });
  } catch (error: any) {
    if (error.message && error.message.includes("FileNotFound")) {
      res.status(404).json({ message: "Không tìm thấy file để xóa" });
    } else {
      res.status(500).json({ message: "Lỗi server", error });
    }
  }
};

// [PUT] Thay thế file âm thanh
export const replaceMusicFile = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const id = String(req.params.id);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ message: "ID không hợp lệ" });
      return;
    }
    if (!req.file) {
      res.status(400).json({ message: "Vui lòng chọn file MP3." });
      return;
    }

    const bucket = getBucket("mp3");
    const objectId = new mongoose.Types.ObjectId(id);

    const files = await bucket.find({ _id: objectId }).toArray();
    if (files.length === 0) {
      res.status(404).json({ message: "Không tìm thấy bài nhạc" });
      return;
    }

    const oldMetadata = files[0]?.metadata || {};
    await bucket.delete(objectId);

    const filename = Date.now() + "-" + req.file.originalname;

    // Gắn id option dưới dạng any để bỏ qua kiểm tra khắt khe của TS
    const uploadOptions: any = {
      id: objectId,
      metadata: { ...oldMetadata, contentType: req.file.mimetype },
    };

    const uploadStream = bucket.openUploadStream(filename, uploadOptions);

    const readableStream = new Readable();
    readableStream.push(req.file.buffer);
    readableStream.push(null);

    readableStream
      .pipe(uploadStream)
      .on("error", (error) =>
        res.status(500).json({ message: "Lỗi lưu database", error }),
      )
      .on("finish", () => {
        res.json({
          message: "Thay thế nhạc thành công!",
          id: objectId,
          newFilename: filename,
        });
      });
  } catch (error) {
    res.status(500).json({ message: "Lỗi server", error });
  }
};

// [GET] Xem ảnh bìa (STREAM IMAGE)
export const streamImage = (req: Request, res: Response): void => {
  try {
    const id = String(req.params.id);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ message: "ID ảnh không hợp lệ" });
      return;
    }

    const bucket = getBucket("images");
    const stream = bucket.openDownloadStream(new mongoose.Types.ObjectId(id));

    res.set("Content-Type", "image/jpeg");

    stream.on("error", () =>
      res.status(404).json({ message: "Không tìm thấy ảnh" }),
    );
    stream.pipe(res);
  } catch (error) {
    res.status(500).json({ message: "Lỗi server", error });
  }
};
