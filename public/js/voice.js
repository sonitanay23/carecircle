/**
 * Read-aloud and voice questions.
 * Read-aloud uses Google Cloud Text-to-Speech (Indian voices) through the
 * server, and falls back to the browser's own voice if that is unavailable.
 * Voice questions use the browser's speech recognition, then ask Gemini.
 */
import { api } from './api.js';

const LOCALES = {
  en: 'en-IN',
  hi: 'hi-IN',
  ta: 'ta-IN',
  te: 'te-IN',
  bn: 'bn-IN',
  mr: 'mr-IN',
  gu: 'gu-IN',
  kn: 'kn-IN',
  ml: 'ml-IN',
  pa: 'pa-IN',
  ur: 'ur-IN',
};
let current = null;

export function stopSpeaking() {
  if (current) {
    current.pause();
    URL.revokeObjectURL(current.src);
    current = null;
  }
  window.speechSynthesis?.cancel();
}

export async function speak(text, lang = 'en') {
  stopSpeaking();
  try {
    const blob = await api('/api/ai/speak', {
      method: 'POST',
      body: { text: text.slice(0, 1000), lang },
      as: 'blob',
    });
    current = new Audio(URL.createObjectURL(blob));
    await current.play();
    return 'cloud';
  } catch {
    if (!('speechSynthesis' in window))
      throw new Error('Read-aloud is not available on this device.');
    const u = new SpeechSynthesisUtterance(text);
    u.lang = LOCALES[lang] ?? 'en-IN';
    u.rate = 0.9;
    window.speechSynthesis.speak(u);
    return 'browser';
  }
}

export const canListen = () => Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);

/** Listens once and resolves with what was said. */
export function listen(lang = 'en') {
  return new Promise((resolve, reject) => {
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Rec) {
      reject(new Error('Voice input is not available in this browser. Please type your question.'));
      return;
    }
    const rec = new Rec();
    rec.lang = LOCALES[lang] ?? 'en-IN';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => resolve(e.results[0][0].transcript);
    rec.onerror = (e) =>
      reject(
        new Error(
          e.error === 'not-allowed'
            ? 'Please allow the microphone to ask by voice.'
            : 'Sorry, I did not catch that. Please try again.',
        ),
      );
    rec.onend = () => resolve('');
    rec.start();
  });
}
