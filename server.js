import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

// Initialize Gemini
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

console.log("USING NEW GEMINI SDK");

// Chatbot API
app.post("/chat", async (req, res) => {
  try {
    const { question } = req.body;

    const response = await ai.models.generateContent({
      model: "gemini-1.5-flash-preview", // ✅ FIXED MODEL
      contents: `You are a placement preparation assistant.
Only answer questions related to placement.

Question: ${question}`
    });

    const reply =
      response.text ||
      response.candidates?.[0]?.content?.parts?.[0]?.text;

    res.json({ reply });

  } catch (error) {
    console.log("ERROR:", error);
    res.status(500).json({
      error: error.message,
    });
  }
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});