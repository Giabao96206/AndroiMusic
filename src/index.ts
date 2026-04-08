import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import connectdtb from "./config/database";
import musicRoutes from "./router/music.route";

const app = express();
app.use(cors());
app.use(express.json());

// Gắn toàn bộ router nhạc vào tiền tố /api/music
app.use("/api/music", musicRoutes);

// Khởi động Database
connectdtb();

// Chờ DB kết nối xong mới bật Server
mongoose.connection.once("open", () => {
  console.log("🔥 MongoDB đã kết nối. Sẵn sàng phục vụ!");

  // Lấy port từ môi trường (Render cấp) hoặc dùng 5000 nếu chạy ở máy tính
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
});

mongoose.connection.on("error", (err) => {
  console.error("❌ Mongoose kết nối thất bại:", err);
});
