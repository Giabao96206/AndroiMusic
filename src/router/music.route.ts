import express from "express";
import { uploadMiddleware } from "../middlewares/upload.middleware";
import { musicUploadFields } from "../middlewares/upload.middleware";
import * as musicController from "../controllers/music.controller";

const router = express.Router();

// Định nghĩa các endpoints. Trông cực kỳ sạch sẽ và dễ hiểu!
router.post("/upload", musicUploadFields, musicController.uploadMusic);
router.get("/all", musicController.getAllMusic);
router.get("/stream/:name", musicController.streamMusic);
router.patch("/update/:id", musicController.updateMusic);
router.delete("/delete/:id", musicController.deleteMusic); // API Xóa
// Thêm dòng này vào danh sách các route của bạn
router.get("/image/:id", musicController.streamImage);
// Nhớ thêm dòng này ở dưới cùng nhé
router.put(
  "/replace/:id",
  uploadMiddleware.single("mp3"),
  musicController.replaceMusicFile,
);

export default router;
