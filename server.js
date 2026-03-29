import express from "express";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();
app.use(express.json());

// Initialize Gemini
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// Chatbot API
app.post("/chat", async (req, res) => {
  try {
    const { question } = req.body;

    // Send request to Gemini
    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview", // correct model
      contents: `You are a placement preparation assistant.
Only answer questions related to:
- Data Structures
- Algorithms
- Core Subjects
- Aptitude
- Resume
- Interviews

If question is unrelated, politely refuse.

Question: ${question}`
    });

    // Send response back
    res.json({
      reply: response.text,
    });

  } catch (error) {
    console.log("ERROR:", error);
    res.status(500).json({
      error: error.message,
    });
  }
});

// Start server
app.listen(5000, () => {
  console.log("Server started on port 5000");
});