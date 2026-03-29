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

// Dump available Gemini models at startup for debugging and select fallback model
let activeModel = process.env.GEMINI_MODEL;

async function resolveModel() {
  if (activeModel) return activeModel;
  try {
    const info = await ai.models.list();

    const allModels = info?.models || info?.pageInternal || [];
    const candidates = allModels.filter((m) => {
      const nm = (m.name || m.id || '').toLowerCase();
      const methods = m.supportedActions || m.supportedGenerationMethods || m.supportedMethods || [];
      return nm.includes('gemini') && methods.includes('generateContent');
    });

    if (!candidates.length) {
      throw new Error('No available Gemini model supports generateContent. See log to inspect models.');
    }

    activeModel = candidates[0].name || candidates[0].id;
    return activeModel;
  } catch (e) {
    console.error('Model resolution failed', e);
    throw e;
  }
}

// Chatbot API
app.post("/chat", async (req, res) => {
  try {
    const { question } = req.body;

    const model = await resolveModel();
    const response = await ai.models.generateContent({
      model,
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

    const reply =
      response.text ||
      response.candidates?.[0]?.content?.parts?.[0]?.text;

    res.json({ reply });

  } catch (error) {
    console.error("ERROR:", error);
    res.status(500).json({
      error: error.message,
    });
  }
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});