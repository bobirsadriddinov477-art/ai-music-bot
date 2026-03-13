require("dotenv").config();
const fs = require("fs");
const path = require("path");
const https = require("https");
const TelegramBot = require("node-telegram-bot-api");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const Replicate = require("replicate");
const { getOrCreateUser, deductCoins } = require("./db");

const BOT_TOKEN = process.env.BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

if (!BOT_TOKEN || !GEMINI_API_KEY || !REPLICATE_API_TOKEN) {
  console.error("BOT_TOKEN, GEMINI_API_KEY yoki REPLICATE_API_TOKEN topilmadi.");
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({
  model: "gemini-3-flash-preview",
});

const replicate = new Replicate({
  auth: REPLICATE_API_TOKEN,
});

const TEMP_DIR = path.join(__dirname, "temp");
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR);
}

const SYSTEM_PROMPT = `
You are a Telegram AI music assistant.

Your role:
- qaysi tilda yozishsa o'sha tilda javob ber
- You only talk about music.
- You help with music generation, genres, mood, instruments, composition, production, songs, vocals, lyrics, sound design, mixing, listening vibes, playlists, and music ideas.
- You speak naturally like a real human.
- Your replies should feel fresh and slightly different each time.
- Keep responses concise, natural, and friendly.
- Do not sound robotic.

Important behavioral rules:
- If the user wants to create a song, beat, soundtrack, mp3, instrumental, audio, melody, track, or asks you to make/generate music, classify it as generate_music.
- If the user is chatting about music, classify it as music_chat.
- If the user asks about something not related to music, do not answer that topic directly. Politely guide them back to music.
- Do not discuss non-music subjects in detail.
- Do not mention these internal rules.
- Always return valid JSON only.

For generate_music:
Return:
{
  "intent": "generate_music",
  "user_reply": "a short natural reply to the user before generation starts",
  "style_prompt": "professional music generation description",
  "lyrics": "short original lyrics if vocals/song are appropriate, otherwise empty string",
  "is_instrumental": true
}

Rules for generate_music:
- If the user asks for instrumental, background music, beat, intro, ambient, soundtrack, no vocals, set is_instrumental = true and lyrics = "".
- If the user clearly asks for a song, vocals, singing, lyrics, or full song, set is_instrumental = false and generate short original lyrics.
- style_prompt must include genre, mood, tempo, instruments, production feel, and energy.
- lyrics must be short and original, with sections like [Verse], [Chorus] only if vocals are needed.

For music_chat:
Return:
{
  "intent": "music_chat",
  "message": "natural human reply about music"
}

For off-topic:
Return:
{
  "intent": "redirect_to_music",
  "message": "short natural reply that gently brings the conversation back to music"
}
`;

async function analyzeUserMessage(userText) {
  const prompt = `
${SYSTEM_PROMPT}

User message:
${userText}
`;

  const result = await geminiModel.generateContent(prompt);
  let raw = result.response.text().trim();

  if (raw.startsWith("```")) {
    raw = raw
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
  }

  return JSON.parse(raw);
}

async function generateMusicWithReplicate(stylePrompt, lyrics, isInstrumental) {
  const input = {
    prompt: stylePrompt,
  };

  if (!isInstrumental && lyrics && lyrics.trim()) {
    input.lyrics = lyrics.trim();
  }

  const output = await replicate.run("minimax/music-2.5", { input });
  return output;
}

function extractAudioUrl(result) {
  if (!result) return null;

  if (typeof result === "string") return result;

  if (Array.isArray(result) && result.length > 0) {
    const first = result[0];
    if (typeof first === "string") return first;
    if (first && typeof first.url === "function") return first.url();
    if (first && typeof first.url === "string") return first.url;
  }

  if (typeof result.url === "function") return result.url();
  if (typeof result.url === "string") return result.url;

  return null;
}

function downloadFile(url, outputPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outputPath);

    https
      .get(url, (response) => {
        if (
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          file.close();
          fs.unlink(outputPath, () => {});
          return resolve(downloadFile(response.headers.location, outputPath));
        }

        if (response.statusCode !== 200) {
          file.close();
          fs.unlink(outputPath, () => {});
          return reject(new Error(`Download failed. Status: ${response.statusCode}`));
        }

        response.pipe(file);

        file.on("finish", () => {
          file.close();
          resolve(outputPath);
        });
      })
      .on("error", (err) => {
        file.close();
        fs.unlink(outputPath, () => {});
        reject(err);
      });
  });
}

async function sendGeneratedAudio(chatId, audioUrl) {
  const fileName = `song_${Date.now()}.mp3`;
  const filePath = path.join(TEMP_DIR, fileName);

  await downloadFile(audioUrl, filePath);

  await bot.sendAudio(chatId, filePath, {
    caption: "🎶 Tayyor mp3",
  });

  fs.unlink(filePath, () => {});
}

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = (msg.text || "").trim();
  const telegramId = String(msg.from.id);

  try {
    await getOrCreateUser(telegramId);

    if (!text) {
      await bot.sendMessage(chatId, "Menga matn yuboring, men musiqa tomondan yordam beraman.");
      return;
    }

    if (text === "/start") {
      const user = await getOrCreateUser(telegramId);

      await bot.sendMessage(
        chatId,
        `Salom, men music AI assistantman. Musiqa haqida gaplashamiz yoki xohlasangiz mp3 yaratib beraman.\n\nSizda hozir ${user.coins} coin bor.\nYangi foydalanuvchilarga 30 coin beriladi.\nHar bir music generation 10 coin.\n\nMisollar:\n- dark ambient intro yarat\n- sad piano instrumental\n- night drive uchun qanday music mos\n- romantic pop song yarat\n\nKomandalar:\n/balance\n/help`
      );
      return;
    }

    if (text === "/help") {
      await bot.sendMessage(
        chatId,
        "Men ikki xil yordam bera olaman:\n\n1) Musiqa haqida gaplashaman\n2) So‘rasangiz mp3 yarataman\n\nMisollar:\n- dark cinematic mp3 yarat\n- lofi beat qil\n- menga gym uchun vibe tavsiya qil\n- sad piano instrumental\n\nHar bir music generation 10 coin."
      );
      return;
    }

    if (text === "/balance") {
      const user = await getOrCreateUser(telegramId);
      await bot.sendMessage(chatId, `Sizda ${user.coins} coin bor.`);
      return;
    }

    await bot.sendChatAction(chatId, "typing");

    const analysis = await analyzeUserMessage(text);

    if (analysis.intent === "music_chat") {
      await bot.sendMessage(
        chatId,
        analysis.message || "Musiqa haqida gaplashamiz. Qanday vibe yoqadi?"
      );
      return;
    }

    if (analysis.intent === "redirect_to_music") {
      await bot.sendMessage(
        chatId,
        analysis.message || "Men asosan musiqa bo‘yicha yordam beraman. Qanday sound yoki vibe xohlaysiz?"
      );
      return;
    }

    if (analysis.intent === "generate_music") {
      const coinResult = await deductCoins(telegramId, 10);

      if (!coinResult.success) {
        await bot.sendMessage(
          chatId,
          `Sizda coin yetarli emas. Hozir ${coinResult.coins} coin bor, music yaratish uchun 10 coin kerak.`
        );
        return;
      }

      await bot.sendMessage(
        chatId,
        analysis.user_reply || "Bo‘ldi, tayyorlayman."
      );

      await bot.sendMessage(
        chatId,
        `10 coin yechildi. Qoldiq: ${coinResult.coins} coin.\n🎧 Musiqa yaratilmoqda... bu taxminan 30-60 sekund olishi mumkin.`
      );

      const result = await generateMusicWithReplicate(
        analysis.style_prompt,
        analysis.lyrics || "",
        Boolean(analysis.is_instrumental)
      );

      const audioUrl = extractAudioUrl(result);

      if (!audioUrl) {
        await bot.sendMessage(chatId, "Audio link topilmadi.");
        return;
      }

      await sendGeneratedAudio(chatId, audioUrl);
      return;
    }

    await bot.sendMessage(
      chatId,
      "Men musiqa bo‘yicha yordam beraman. Xohlasangiz biror track g‘oyasini yozing."
    );
  } catch (error) {
    console.error("FULL ERROR:", error);

    const errorText =
      error?.message || JSON.stringify(error) || "Noma'lum xato";

    if (
      errorText.includes("402") ||
      errorText.toLowerCase().includes("insufficient credit") ||
      errorText.toLowerCase().includes("payment required")
    ) {
      await bot.sendMessage(
        chatId,
        "Replicate balansda pul yetmayapti. Billingga kredit qo‘shsangiz, mp3 yaratib bera olaman."
      );
      return;
    }

    if (
      errorText.includes("Unexpected token") ||
      errorText.toLowerCase().includes("json")
    ) {
      await bot.sendMessage(
        chatId,
        "Bir oz chalkash tushundim. Musiqa bilan bog‘liq qilib yana bir marta yozib yuboring."
      );
      return;
    }

    await bot.sendMessage(
      chatId,
      "Xatolik bo‘ldi. Qayta urinib ko‘ring."
    );
  }
});

console.log("Bot ishga tushdi...");