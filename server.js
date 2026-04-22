import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

const SYSTEM_PROMPT = `You are a placement preparation assistant.
Only answer questions related to:
- Data Structures
- Algorithms
- Core Subjects
- Aptitude
- Resume
- Interviews
If question is unrelated, politely refuse.`;

const RETRYABLE_HTTP_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRYABLE_CODES = new Set(["UNAVAILABLE", "RESOURCE_EXHAUSTED", "DEADLINE_EXCEEDED"]);

// Initialize Gemini
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// Dump available Gemini models at startup for debugging and select fallback model
let activeModel = process.env.GEMINI_MODEL;

const configuredFallbackModels = (process.env.GEMINI_FALLBACK_MODELS || "")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

const defaultFallbackModels = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeModelName(name) {
  return String(name || "")
    .trim()
    .replace(/^models\//i, "")
    .toLowerCase();
}

async function listGenerateContentModels() {
  const info = await ai.models.list();
  const allModels = info?.models || info?.pageInternal || [];

  return allModels
    .filter((m) => {
      const nm = (m.name || m.id || "").toLowerCase();
      const methods = m.supportedActions || m.supportedGenerationMethods || m.supportedMethods || [];
      return nm.includes("gemini") && methods.includes("generateContent");
    })
    .map((m) => m.name || m.id)
    .filter(Boolean);
}

function toAvailableModel(preferred, availableModels) {
  const target = normalizeModelName(preferred);
  if (!target) return undefined;

  return availableModels.find((m) => normalizeModelName(m) === target);
}

function buildOrderedModels(availableModels) {
  const preferred = [
    ...(activeModel ? [activeModel] : []),
    ...configuredFallbackModels,
    ...defaultFallbackModels,
  ];

  const mappedPreferred = preferred
    .map((m) => toAvailableModel(m, availableModels))
    .filter(Boolean);

  const ordered = [...mappedPreferred, ...availableModels]
    .filter((model, idx, arr) => model && arr.indexOf(model) === idx);

  return ordered;
}

function extractRetryInfo(error) {
  const status =
    error?.status ||
    error?.code ||
    error?.response?.status ||
    error?.error?.code;

  const code =
    error?.error?.status ||
    error?.details?.status ||
    error?.statusText ||
    error?.error?.code;

  const rawMessage =
    error?.message ||
    error?.error?.message ||
    "";

  let parsed;
  if (typeof rawMessage === "string" && rawMessage.trim().startsWith("{")) {
    try {
      parsed = JSON.parse(rawMessage);
    } catch {
      parsed = null;
    }
  }

  const nested = parsed?.error || parsed;
  const nestedStatus = nested?.code;
  const nestedCode = nested?.status;

  const finalStatus = Number(status ?? nestedStatus ?? 0);
  const finalCode = String(code || nestedCode || "").toUpperCase();

  const retryable = RETRYABLE_HTTP_STATUS.has(finalStatus) || RETRYABLE_CODES.has(finalCode);

  return {
    status: finalStatus || undefined,
    code: finalCode || undefined,
    retryable,
    message: rawMessage,
  };
}

async function resolveModel() {
  try {
    const availableModels = await listGenerateContentModels();

    if (!availableModels.length) {
      throw new Error("No available Gemini model supports generateContent. See log to inspect models.");
    }

    const ordered = buildOrderedModels(availableModels);
    activeModel = ordered[0];
    return activeModel;
  } catch (e) {
    console.error("Model resolution failed", e);
    throw e;
  }
}

async function generateWithRetryAndFallback(question) {
  const availableModels = await listGenerateContentModels();

  if (!availableModels.length) {
    throw new Error("No available Gemini model supports generateContent.");
  }

  const orderedModels = buildOrderedModels(availableModels);

  const maxRetriesPerModel = 2;
  let lastError;

  for (const model of orderedModels) {
    for (let attempt = 0; attempt <= maxRetriesPerModel; attempt += 1) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: `${SYSTEM_PROMPT}\n\nQuestion: ${question}`,
        });

        activeModel = model;
        return response;
      } catch (error) {
        lastError = error;
        const retryInfo = extractRetryInfo(error);

        const isLastTryOnModel = attempt === maxRetriesPerModel;
        if (!retryInfo.retryable || isLastTryOnModel) {
          break;
        }

        const backoffMs = 600 * Math.pow(2, attempt);
        await delay(backoffMs);
      }
    }
  }

  throw lastError;
}

// Chatbot API
app.post("/chat", async (req, res) => {
  try {
    const { question } = req.body;

    if (typeof question !== "string" || !question.trim()) {
      return res.status(400).json({
        error: "Question is required and must be a non-empty string.",
      });
    }

    const response = await generateWithRetryAndFallback(question.trim());

    const reply =
      response.text ||
      response.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!reply) {
      return res.status(502).json({
        error: "Model returned an empty response. Please retry.",
      });
    }

    res.json({ reply });

  } catch (error) {
    const retryInfo = extractRetryInfo(error);
    console.error("ERROR:", {
      status: retryInfo.status,
      code: retryInfo.code,
      message: retryInfo.message,
    });

    const statusCode = retryInfo.retryable ? 503 : 500;
    const message = retryInfo.retryable
      ? "Gemini is currently busy. Please retry in a few seconds."
      : "Failed to process request.";

    res.status(statusCode).json({
      error: message,
      details: retryInfo.message || String(error),
    });
  }
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});