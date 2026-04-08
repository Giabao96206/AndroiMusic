import multer from "multer";

const storage = multer.memoryStorage();

export const uploadMiddleware = multer({
  storage,
  fileFilter: (req, file, cb) => {
    // Chấp nhận cả mp3 và các định dạng ảnh phổ biến
    if (
      file.mimetype === "audio/mpeg" ||
      file.mimetype.startsWith("image/") ||
      file.originalname.match(/\.(mp3|jpg|jpeg|png|webp)$/i)
    ) {
      cb(null, true);
    } else {
      cb(new Error("Định dạng file không hỗ trợ!"));
    }
  },
  limits: { fileSize: 20 * 1024 * 1024 }, // Giới hạn 20MB cho toàn bộ
});

// Định nghĩa các trường nhận file
export const musicUploadFields = uploadMiddleware.fields([
  { name: "mp3", maxCount: 1 },
  { name: "img", maxCount: 1 },
]);
