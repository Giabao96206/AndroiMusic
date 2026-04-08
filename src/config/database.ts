import mongoose from "mongoose";

const add: string = "tranvangiabao96206_db_user";
const pass: string = "sQfevT3e3BQGxpiO";

const connectdtb = async (): Promise<void> => {
  try {
    await mongoose.connect(
      `mongodb+srv://${add}:${pass}@cluster0.l2gjlbd.mongodb.net/NotFlix`,
    );
    console.log("Kết nối database thành công!");
  } catch (error) {
    console.error("Kết nối database thất bại!", error);
  }
};

export default connectdtb;
