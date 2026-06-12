const express = require('express');
const { middleware, messagingApi } = require('@line/bot-sdk');
const mongoose = require('mongoose');
const vision = require('@google-cloud/vision');

const app = express();

// 1. เชื่อมต่อ MongoDB Atlas ผ่าน Environment Variable (.env)
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB Connected successfully!'))
  .catch(err => console.error('MongoDB connection error:', err));

// 2. สร้างโครงสร้างตาราง (Schema) สำหรับเก็บประวัติ
const UserLogSchema = new mongoose.Schema({
  lineUserId: String,
  status: String,
  detectedText: String,
  timestamp: { type: Date, default: Date.now }
});
const UserLog = mongoose.model('UserLog', UserLogSchema);

// 3. ตั้งค่า LINE API ด้วยเวอร์ชันใหม่ล่าสุด (ประกาศ Client แค่ที่เดียว)
const config = {
  channelAccessToken: process.env.LINE_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};

const client = new messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_ACCESS_TOKEN
});

const blobClient = new messagingApi.MessagingApiBlobClient({
  channelAccessToken: process.env.LINE_ACCESS_TOKEN
});

// 4. สร้าง Route สำหรับรับ Webhook
app.post('/webhook', middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleLineEvent))
    .then(() => res.status(200).end())
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
});

async function handleLineEvent(event) {
  const lineUserId = event.source.userId;

  if (event.type !== 'message' || event.message.type !== 'image') {
    return replyMissingInfo(event.replyToken);
  }

  try {
    // ใช้ blobClient สำหรับดึงไฟล์รูปภาพของเวอร์ชันใหม่
    const stream = await blobClient.getMessageContent(event.message.id);
    const imageBuffer = await streamToBuffer(stream); 
    
    const visionClient = new vision.ImageAnnotatorClient();
    const [result] = await visionClient.textDetection({ image: { content: imageBuffer } });
    const detectedText = result.fullTextAnnotation ? result.fullTextAnnotation.text : '';

const isGoogleFormSuccess = detectedText.includes('บันทึกคำตอบ') || 
                            detectedText.includes('ได้รับคำตอบ') ||
                            detectedText.includes('คำตอบของคุณ');
    if (isGoogleFormSuccess) {
     // await UserLog.create({ lineUserId, status: 'SUCCESS', detectedText });

      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{
          type: 'image',
          originalContentUrl: 'https://drive.google.com/file/d/1sMIRQK_L63WQ_HH9DHogO8xchYVGGF-0', // เปลี่ยนเป็นลิงก์รูป QR Code จริงของคุณ
          previewImageUrl: 'https://drive.google.com/file/d/1sMIRQK_L63WQ_HH9DHogO8xchYVGGF-0'
        }]
      });
    } else {
    //  await UserLog.create({ lineUserId, status: 'FAILED', detectedText });
      return replyMissingInfo(event.replyToken);
    }
  } catch (error) {
    console.error(error);
    return replyMissingInfo(event.replyToken);
  }
}

function replyMissingInfo(replyToken) {
  return client.replyMessage({
    replyToken: replyToken,
    messages: [{
      type: 'text',
      text: 'กรุณากรอกข้อมูลให้ครบถ้วน และส่งภาพหน้าจอสำเร็จรูปมาใหม่อีกครั้งค่ะ'
    }]
  });
}

function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));