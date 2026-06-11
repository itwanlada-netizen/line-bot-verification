const express = require('express');
const { messagingApi } = require('@line/bot-sdk');
const mongoose = require('mongoose');
const vision = require('@google-cloud/vision');
// ... ตั้งค่า config ...
const client = new messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_ACCESS_TOKEN // แนะนำให้เรียกผ่าน env ตรงนี้เลยครับ
});
const app = express();

// 1. เชื่อมต่อ MongoDB Atlas (เอา Connection String จากบทความที่แล้วมาแปะที่นี่)
const mongoURI = process.env.MONGO_URI;
mongoose.connect(mongoURI)
  .then(() => console.log('MongoDB Connected successfully!'))
  .catch(err => console.error('MongoDB connection error:', err));

// 2. สร้างโครงสร้างตาราง (Schema) สำหรับเก็บประวัติลูกค้าใน MongoDB
const UserLogSchema = new mongoose.Schema({
  lineUserId: String,      // ไอดีไลน์ของลูกค้า
  status: String,          // สถานะ เช่น 'SUCCESS' (ส่งรูปฟอร์มผ่าน) หรือ 'FAILED'
  detectedText: String,    // ข้อความที่ AI แกะออกมาได้จากรูป (เก็บไว้เช็คย้อนหลัง)
  timestamp: { type: Date, default: Date.now }
});
const UserLog = mongoose.model('UserLog', UserLogSchema);

// 3. ตั้งค่า LINE API
const config = {
  channelAccessToken: process.env.LINE_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};
const client = new line.Client(config);

// 4. สร้าง Route สำหรับรับ Webhook จาก LINE
app.post('https://line-bot-verification.onrender.com/webhook', line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleLineEvent))
    .then(() => res.status(200).end())
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
});

async function handleLineEvent(event) {
  const lineUserId = event.source.userId;

  // ถ้าไม่ใช่รูปภาพ -> ส่งข้อความเตือน และไม่บันทึกอะไร
  if (event.type !== 'message' || event.message.type !== 'image') {
    return replyMissingInfo(event.replyToken);
  }

  try {
    // ดึงรูปและตรวจจับข้อความด้วย Google Vision API
    const stream = await client.getMessageContent(event.message.id);
    const imageBuffer = await streamToBuffer(stream); 
    const visionClient = new vision.ImageAnnotatorClient();
    const [result] = await visionClient.textDetection({ image: { content: imageBuffer } });
    const detectedText = result.fullTextAnnotation ? result.fullTextAnnotation.text : '';

    // เช็ค Keyword สำคัญของ Google Form
    const isGoogleFormSuccess = detectedText.includes('ได้รับคำตอบของคุณแล้ว') || 
                                detectedText.includes('บันทึกคำตอบของคุณแล้ว');

    if (isGoogleFormSuccess) {
      // 🌟 บันทึกประวัติลง MongoDB ว่าคนนี้ผ่านแล้ว
      await UserLog.create({ lineUserId, status: 'SUCCESS', detectedText });

      // ส่ง QR Code ให้ลูกค้า
      return client.replyMessage(event.replyToken, {
        type: 'image',
        originalContentUrl: 'https://yourdomain.com/qrcode.png',
        previewImageUrl: 'https://yourdomain.com/qrcode-preview.png'
      });
    } else {
      // 🌟 บันทึกประวัติลง MongoDB ว่าคนนี้ส่งรูปมาผิด
      await UserLog.create({ lineUserId, status: 'FAILED', detectedText });

      return replyMissingInfo(event.replyToken);
    }
  } catch (error) {
    console.error(error);
    return replyMissingInfo(event.replyToken);
  }
}

function replyMissingInfo(replyToken) {
  return client.replyMessage(replyToken, {
    type: 'text',
    text: 'กรุณากรอกข้อมูลให้ครบถ้วน และส่งภาพหน้าจอสำเร็จรูปมาใหม่อีกครั้งค่ะ'
  });
}

// ฟังก์ชันแปลง Stream เป็น Buffer
function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

app.listen(3000, () => console.log('Server is running on port 3000'));