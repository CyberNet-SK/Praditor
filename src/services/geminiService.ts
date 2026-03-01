import { GoogleGenAI, Modality, GenerateContentResponse, LiveServerMessage } from "@google/genai";

const SYSTEM_INSTRUCTION = `You are "Predator", an elite-tier Cybersecurity Expert and Ethical Hacking Specialist. 
Your tone is professional, sharp, analytical, and seasoned veteran style.
You are multilingual (Bangla and English) and respond in the language the user uses.
Your expertise includes OWASP Top 10, penetration testing, code review (SQLi, XSS), tool expertise (Kali, Metasploit, Nmap), and strategic defense.
SAFETY RULE: Strictly follow White Hat methodology. Decline any requests for illegal activities, hacking into unauthorized systems, or creating malware. Redirect users to ethical testing, bug bounties, and defensive security practices.
When providing code, ensure it is secure and explain the security implications.`;

export class GeminiService {
  private ai: GoogleGenAI;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not defined");
    }
    this.ai = new GoogleGenAI({ apiKey });
  }

  async chat(message: string, history: { role: 'user' | 'model', parts: { text: string }[] }[] = []) {
    const chat = this.ai.chats.create({
      model: "gemini-3.1-pro-preview",
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
      },
      history: history,
    });

    const response = await chat.sendMessage({ message });
    return response;
  }

  async generateTTS(text: string): Promise<string | undefined> {
    const response = await this.ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: `Say with an authoritative, professional tone: ${text}` }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Fenrir' },
          },
        },
      },
    });

    return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  }

  async connectLive(callbacks: {
    onopen?: () => void;
    onmessage?: (message: LiveServerMessage) => void;
    onerror?: (error: any) => void;
    onclose?: () => void;
  }) {
    return this.ai.live.connect({
      model: "gemini-2.5-flash-native-audio-preview-09-2025",
      callbacks,
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
        },
        systemInstruction: SYSTEM_INSTRUCTION,
      },
    });
  }
}

export const gemini = new GeminiService();
