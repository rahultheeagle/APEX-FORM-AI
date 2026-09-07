/**
 * @fileoverview Layer 2 (Audio): voiceCoach.js
 * Multilingual speech synthesis coaching engine covering 10 major global languages:
 * - English (en-US), Mandarin (zh-CN), Hindi (hi-IN), Spanish (es-ES), French (fr-FR),
 *   Arabic (ar-SA), Bengali (bn-IN), Portuguese (pt-BR), Russian (ru-RU), Japanese (ja-JP).
 * Features real-time voice matching, volume/pitch/speed controls, and a strict 2.0s debounce window.
 */

/**
 * Supported language configuration constants.
 * @type {Record<string, { code: string, label: string, native: string }>}
 */
export const SUPPORTED_LANGUAGES = {
  'en-US': { code: 'en-US', label: 'English (US)', native: 'English' },
  'zh-CN': { code: 'zh-CN', label: 'Mandarin (Chinese)', native: '中文' },
  'hi-IN': { code: 'hi-IN', label: 'Hindi (India)', native: 'हिन्दी' },
  'es-ES': { code: 'es-ES', label: 'Spanish', native: 'Español' },
  'fr-FR': { code: 'fr-FR', label: 'French', native: 'Français' },
  'ar-SA': { code: 'ar-SA', label: 'Arabic', native: 'العربية' },
  'bn-IN': { code: 'bn-IN', label: 'Bengali', native: 'বাংলা' },
  'pt-BR': { code: 'pt-BR', label: 'Portuguese (Brazil)', native: 'Português' },
  'ru-RU': { code: 'ru-RU', label: 'Russian', native: 'Русский' },
  'ja-JP': { code: 'ja-JP', label: 'Japanese', native: '日本語' },
};

/**
 * Standardized Phrase Keys for the Voice Coaching Engine.
 * @enum {string}
 */
export const PhraseKey = {
  WORKOUT_STARTED: 'WORKOUT_STARTED',
  WORKOUT_PAUSED: 'WORKOUT_PAUSED',
  WORKOUT_RESUMED: 'WORKOUT_RESUMED',
  WORKOUT_COMPLETED: 'WORKOUT_COMPLETED',
  REP_SUCCESS: 'REP_SUCCESS',
  GO_LOWER: 'GO_LOWER',
  GO_HIGHER: 'GO_HIGHER',
  CHEST_UP: 'CHEST_UP',
  KNEES_OUT: 'KNEES_OUT',
  SET_COMPLETE: 'SET_COMPLETE',
  STEP_BACK: 'STEP_BACK',
  STEP_CLOSER: 'STEP_CLOSER',
  CONTROL_DESCENT: 'CONTROL_DESCENT',
  DRIVE_UP: 'DRIVE_UP',
  SIDE_VIEW: 'SIDE_VIEW',
  FRONT_VIEW: 'FRONT_VIEW',
};

/**
 * 10-Language Dictionary of athletic biomechanical cues.
 * @type {Record<string, Record<string, string>>}
 */
const I18N_DICTIONARY = {
  'en-US': {
    [PhraseKey.WORKOUT_STARTED]: 'Workout started',
    [PhraseKey.WORKOUT_PAUSED]: 'Workout paused',
    [PhraseKey.WORKOUT_RESUMED]: 'Workout resumed',
    [PhraseKey.WORKOUT_COMPLETED]: 'Workout completed',
    [PhraseKey.REP_SUCCESS]: 'Good rep',
    [PhraseKey.GO_LOWER]: 'Go lower',
    [PhraseKey.GO_HIGHER]: 'Go higher',
    [PhraseKey.CHEST_UP]: 'Chest up',
    [PhraseKey.KNEES_OUT]: 'Push knees outward',
    [PhraseKey.SET_COMPLETE]: 'Set complete',
    [PhraseKey.STEP_BACK]: 'Step back slightly',
    [PhraseKey.STEP_CLOSER]: 'Step closer to camera',
    [PhraseKey.CONTROL_DESCENT]: 'Control your descent',
    [PhraseKey.DRIVE_UP]: 'Drive up',
    [PhraseKey.SIDE_VIEW]: 'Side view detected, tracking squat depth.',
    [PhraseKey.FRONT_VIEW]: 'Front view detected, tracking symmetry.',
  },
  'zh-CN': {
    [PhraseKey.WORKOUT_STARTED]: '训练开始',
    [PhraseKey.WORKOUT_PAUSED]: '训练暂停',
    [PhraseKey.WORKOUT_RESUMED]: '训练继续',
    [PhraseKey.WORKOUT_COMPLETED]: '训练完成',
    [PhraseKey.REP_SUCCESS]: '动作标准',
    [PhraseKey.GO_LOWER]: '蹲低一点',
    [PhraseKey.GO_HIGHER]: '抬高一点',
    [PhraseKey.CHEST_UP]: '挺胸抬头',
    [PhraseKey.KNEES_OUT]: '膝盖向外打开',
    [PhraseKey.SET_COMPLETE]: '本组完成',
    [PhraseKey.STEP_BACK]: '请后退一点',
    [PhraseKey.STEP_CLOSER]: '请靠近镜头',
    [PhraseKey.CONTROL_DESCENT]: '控制下蹲速度',
    [PhraseKey.DRIVE_UP]: '发力站起',
    [PhraseKey.SIDE_VIEW]: '检测到侧面视角，正在追踪下蹲深度。',
    [PhraseKey.FRONT_VIEW]: '检测到正面视角，正在追踪身体对称性。',
  },
  'hi-IN': {
    [PhraseKey.WORKOUT_STARTED]: 'वर्कआउट शुरू हुआ',
    [PhraseKey.WORKOUT_PAUSED]: 'वर्कआउट रुका हुआ है',
    [PhraseKey.WORKOUT_RESUMED]: 'वर्कआउट फिर से शुरू हुआ',
    [PhraseKey.WORKOUT_COMPLETED]: 'वर्कआउट पूरा हुआ',
    [PhraseKey.REP_SUCCESS]: 'बढ़िया रेप',
    [PhraseKey.GO_LOWER]: 'और नीचे जाओ',
    [PhraseKey.GO_HIGHER]: 'और ऊपर उठाओ',
    [PhraseKey.CHEST_UP]: 'सीना सीधा रखो',
    [PhraseKey.KNEES_OUT]: 'घुटने बाहर रखें',
    [PhraseKey.SET_COMPLETE]: 'सेट पूरा हुआ',
    [PhraseKey.STEP_BACK]: 'थोड़ा पीछे हटें',
    [PhraseKey.STEP_CLOSER]: 'कैमरे के करीब आएं',
    [PhraseKey.CONTROL_DESCENT]: 'धीमी गति से नीचे जाएं',
    [PhraseKey.DRIVE_UP]: 'पूरी ताकत से ऊपर आएं',
    [PhraseKey.SIDE_VIEW]: 'साइड व्यू डिटेक्ट हुआ, डेप्थ ट्रैक हो रही है।',
    [PhraseKey.FRONT_VIEW]: 'फ्रंट व्यू डिटेक्ट हुआ, सिमिट्री ट्रैक हो रही है।',
  },
  'es-ES': {
    [PhraseKey.WORKOUT_STARTED]: 'Entrenamiento iniciado',
    [PhraseKey.WORKOUT_PAUSED]: 'Entrenamiento pausado',
    [PhraseKey.WORKOUT_RESUMED]: 'Entrenamiento reanudado',
    [PhraseKey.WORKOUT_COMPLETED]: 'Entrenamiento completado',
    [PhraseKey.REP_SUCCESS]: 'Buena repetición',
    [PhraseKey.GO_LOWER]: 'Baja más',
    [PhraseKey.GO_HIGHER]: 'Sube más',
    [PhraseKey.CHEST_UP]: 'Pecho arriba',
    [PhraseKey.KNEES_OUT]: 'Rodillas hacia afuera',
    [PhraseKey.SET_COMPLETE]: 'Serie completa',
    [PhraseKey.STEP_BACK]: 'Da un paso atrás',
    [PhraseKey.STEP_CLOSER]: 'Acércate a la cámara',
    [PhraseKey.CONTROL_DESCENT]: 'Controla la bajada',
    [PhraseKey.DRIVE_UP]: 'Sube con fuerza',
    [PhraseKey.SIDE_VIEW]: 'Vista lateral detectada, siguiendo profundidad.',
    [PhraseKey.FRONT_VIEW]: 'Vista frontal detectada, siguiendo simetría.',
  },
  'fr-FR': {
    [PhraseKey.WORKOUT_STARTED]: 'Entraînement démarré',
    [PhraseKey.WORKOUT_PAUSED]: 'Entraînement en pause',
    [PhraseKey.WORKOUT_RESUMED]: 'Entraînement repris',
    [PhraseKey.WORKOUT_COMPLETED]: 'Entraînement terminé',
    [PhraseKey.REP_SUCCESS]: 'Très bien',
    [PhraseKey.GO_LOWER]: 'Plus bas',
    [PhraseKey.GO_HIGHER]: 'Plus haut',
    [PhraseKey.CHEST_UP]: 'Torse droit',
    [PhraseKey.KNEES_OUT]: 'Genoux vers l\'extérieur',
    [PhraseKey.SET_COMPLETE]: 'Série terminée',
    [PhraseKey.STEP_BACK]: 'Reculez un peu',
    [PhraseKey.STEP_CLOSER]: 'Rapprochez-vous de la caméra',
    [PhraseKey.CONTROL_DESCENT]: 'Contrôlez la descente',
    [PhraseKey.DRIVE_UP]: 'Poussez vers le haut',
    [PhraseKey.SIDE_VIEW]: 'Vue de profil détectée, suivi de profondeur.',
    [PhraseKey.FRONT_VIEW]: 'Vue de face détectée, suivi de symétrie.',
  },
  'ar-SA': {
    [PhraseKey.WORKOUT_STARTED]: 'بدأ التمرين',
    [PhraseKey.WORKOUT_PAUSED]: 'تم إيقاف التمرين مؤقتاً',
    [PhraseKey.WORKOUT_RESUMED]: 'تم استئناف التمرين',
    [PhraseKey.WORKOUT_COMPLETED]: 'اكتمل التمرين',
    [PhraseKey.REP_SUCCESS]: 'تكرار ممتاز',
    [PhraseKey.GO_LOWER]: 'انزل أكثر',
    [PhraseKey.GO_HIGHER]: 'ارفع أكثر',
    [PhraseKey.CHEST_UP]: 'ارفع صدرك',
    [PhraseKey.KNEES_OUT]: 'ادفع الركبتين للخارج',
    [PhraseKey.SET_COMPLETE]: 'اكتملت المجموعة',
    [PhraseKey.STEP_BACK]: 'تراجع قليلاً للوراء',
    [PhraseKey.STEP_CLOSER]: 'اقترب من الكاميرا',
    [PhraseKey.CONTROL_DESCENT]: 'تحكم في سرعة النزول',
    [PhraseKey.DRIVE_UP]: 'ادفع للأعلى بقوة',
    [PhraseKey.SIDE_VIEW]: 'تم رصد الرؤية الجانبية وتتبع العمق.',
    [PhraseKey.FRONT_VIEW]: 'تم رصد الرؤية الأمامية وتتبع التوازن.',
  },
  'bn-IN': {
    [PhraseKey.WORKOUT_STARTED]: 'ওয়ার্কআউট শুরু হয়েছে',
    [PhraseKey.WORKOUT_PAUSED]: 'ওয়ার্কআউট স্থগিত',
    [PhraseKey.WORKOUT_RESUMED]: 'ওয়ার্কআউট আবার শুরু হয়েছে',
    [PhraseKey.WORKOUT_COMPLETED]: 'ওয়ার্কআউট সম্পন্ন',
    [PhraseKey.REP_SUCCESS]: 'দারুণ রেপ',
    [PhraseKey.GO_LOWER]: 'আরও নিচে নামুন',
    [PhraseKey.GO_HIGHER]: 'আরও উপরে তুলুন',
    [PhraseKey.CHEST_UP]: 'বুক সোজা রাখুন',
    [PhraseKey.KNEES_OUT]: 'হাঁটু বাইরে রাখুন',
    [PhraseKey.SET_COMPLETE]: 'সেট সম্পন্ন হয়েছে',
    [PhraseKey.STEP_BACK]: 'একটু পিছিয়ে যান',
    [PhraseKey.STEP_CLOSER]: 'ক্যামেরার কাছে আসুন',
    [PhraseKey.CONTROL_DESCENT]: 'ধীরে নিচে নামুন',
    [PhraseKey.DRIVE_UP]: 'জোরে উপরে উঠুন',
    [PhraseKey.SIDE_VIEW]: 'সাইড ভিউ শনাক্ত হয়েছে, ডেপথ ট্র্যাক হচ্ছে।',
    [PhraseKey.FRONT_VIEW]: 'সামনের ভিউ শনাক্ত হয়েছে, ভারসাম্য ট্র্যাক হচ্ছে।',
  },
  'pt-BR': {
    [PhraseKey.WORKOUT_STARTED]: 'Treino iniciado',
    [PhraseKey.WORKOUT_PAUSED]: 'Treino pausado',
    [PhraseKey.WORKOUT_RESUMED]: 'Treino retomado',
    [PhraseKey.WORKOUT_COMPLETED]: 'Treino concluído',
    [PhraseKey.REP_SUCCESS]: 'Boa repetição',
    [PhraseKey.GO_LOWER]: 'Desça mais',
    [PhraseKey.GO_HIGHER]: 'Suba mais',
    [PhraseKey.CHEST_UP]: 'Peito erguido',
    [PhraseKey.KNEES_OUT]: 'Joelhos para fora',
    [PhraseKey.SET_COMPLETE]: 'Série concluída',
    [PhraseKey.STEP_BACK]: 'Dê um passo para trás',
    [PhraseKey.STEP_CLOSER]: 'Aproxime-se da câmera',
    [PhraseKey.CONTROL_DESCENT]: 'Controle a descida',
    [PhraseKey.DRIVE_UP]: 'Empurre para cima',
    [PhraseKey.SIDE_VIEW]: 'Vista lateral detectada, rastreando profundidade.',
    [PhraseKey.FRONT_VIEW]: 'Vista frontal detectada, rastreando simetria.',
  },
  'ru-RU': {
    [PhraseKey.WORKOUT_STARTED]: 'Тренировка началась',
    [PhraseKey.WORKOUT_PAUSED]: 'Тренировка на паузе',
    [PhraseKey.WORKOUT_RESUMED]: 'Тренировка возобновлена',
    [PhraseKey.WORKOUT_COMPLETED]: 'Тренировка завершена',
    [PhraseKey.REP_SUCCESS]: 'Отлично',
    [PhraseKey.GO_LOWER]: 'Опуститесь ниже',
    [PhraseKey.GO_HIGHER]: 'Поднимите выше',
    [PhraseKey.CHEST_UP]: 'Грудь вперед',
    [PhraseKey.KNEES_OUT]: 'Колени в стороны',
    [PhraseKey.SET_COMPLETE]: 'Сет завершен',
    [PhraseKey.STEP_BACK]: 'Отойдите назад',
    [PhraseKey.STEP_CLOSER]: 'Подойдите ближе',
    [PhraseKey.CONTROL_DESCENT]: 'Контролируйте спуск',
    [PhraseKey.DRIVE_UP]: 'Вставайте с усилием',
    [PhraseKey.SIDE_VIEW]: 'Определен вид сбоку, отслеживание глубины.',
    [PhraseKey.FRONT_VIEW]: 'Определен вид спереди, отслеживание симметрии.',
  },
  'ja-JP': {
    [PhraseKey.WORKOUT_STARTED]: 'トレーニング開始',
    [PhraseKey.WORKOUT_PAUSED]: 'トレーニング一時停止',
    [PhraseKey.WORKOUT_RESUMED]: 'トレーニング再開',
    [PhraseKey.WORKOUT_COMPLETED]: 'トレーニング完了',
    [PhraseKey.REP_SUCCESS]: 'ナイスレップ',
    [PhraseKey.GO_LOWER]: 'もっと深く',
    [PhraseKey.GO_HIGHER]: 'もっと高く',
    [PhraseKey.CHEST_UP]: '胸を張って',
    [PhraseKey.KNEES_OUT]: '膝を外側に開いて',
    [PhraseKey.SET_COMPLETE]: 'セット完了',
    [PhraseKey.STEP_BACK]: '少し下がってください',
    [PhraseKey.STEP_CLOSER]: 'カメラに近づいてください',
    [PhraseKey.CONTROL_DESCENT]: 'ゆっくり下ろして',
    [PhraseKey.DRIVE_UP]: '一気に立ち上がって',
    [PhraseKey.SIDE_VIEW]: '横向きを検知しました。深さを計測します。',
    [PhraseKey.FRONT_VIEW]: '正面を検知しました。対称性を計測します。',
  },
};

/**
 * Throttle cooldown window (milliseconds).
 * @type {number}
 */
const MIN_SPEECH_INTERVAL_MS = 2000;

export class VoiceCoach {
  constructor() {
    /** @type {string} Current target language code */
    this.currentLanguage = 'en-US';

    /** @type {number} Master volume [0.0 - 1.0] */
    this.volume = 1.0;
    /** @type {number} Speech rate [0.8 - 1.5] */
    this.rate = 1.05;
    /** @type {number} Pitch [0.7 - 1.4] */
    this.pitch = 1.0;

    /** @type {SpeechSynthesisVoice|null} */
    this.activeVoice = null;

    /** @type {string} Last spoken text cue */
    this.lastSpokenText = '';
    /** @type {number} Timestamp of last spoken cue */
    this.lastSpokenTime = 0;

    // Initialize voice list handling asynchronously
    this._initVoiceMatching();
  }

  /**
   * Initializes browser voices and updates on voice changes.
   * @private
   */
  _initVoiceMatching() {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    const updateVoices = () => {
      this._resolveBestVoice(this.currentLanguage);
    };

    updateVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = updateVoices;
    }
  }

  /**
   * Resolves the best matching voice for a given language code.
   * 
   * @param {string} langCode
   * @private
   */
  _resolveBestVoice(langCode) {
    if (!('speechSynthesis' in window)) return;

    const voices = window.speechSynthesis.getVoices();
    if (!voices || voices.length === 0) return;

    const prefix = langCode.split('-')[0].toLowerCase();

    // Priority 1: Exact language match with Natural/Google/Siri quality
    let match = voices.find(v => v.lang.toLowerCase() === langCode.toLowerCase() &&
      (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Premium') || v.name.includes('Siri')));

    // Priority 2: Exact language code match
    if (!match) {
      match = voices.find(v => v.lang.toLowerCase() === langCode.toLowerCase());
    }

    // Priority 3: Prefix language match (e.g. 'es' for 'es-ES')
    if (!match) {
      match = voices.find(v => v.lang.toLowerCase().startsWith(prefix));
    }

    // Priority 4: Default voice
    if (!match && voices.length > 0) {
      match = voices[0];
    }

    this.activeVoice = match || null;
  }

  /**
   * Sets target voice language code.
   * 
   * @param {string} langCode Supported language code (e.g. 'en-US', 'hi-IN', 'zh-CN', etc.)
   */
  setLanguage(langCode) {
    if (SUPPORTED_LANGUAGES[langCode]) {
      this.currentLanguage = langCode;
      this._resolveBestVoice(langCode);
    }
  }

  /**
   * Sets master voice volume [0.0 - 1.0].
   * @param {number} vol
   */
  setVolume(vol) {
    this.volume = Math.max(0.0, Math.min(1.0, vol));
  }

  /**
   * Sets speech rate [0.8 - 1.5].
   * @param {number} rate
   */
  setRate(rate) {
    this.rate = Math.max(0.8, Math.min(1.5, rate));
  }

  /**
   * Sets speech pitch [0.7 - 1.4].
   * @param {number} pitch
   */
  setPitch(pitch) {
    this.pitch = Math.max(0.7, Math.min(1.4, pitch));
  }

  /**
   * Speaks a localized phrase by key using the active language dictionary.
   * 
   * @param {string} phraseKey Key from PhraseKey enum.
   * @param {boolean} [force=false] Bypasses text equality check.
   */
  speakPhrase(phraseKey, force = false) {
    const langDict = I18N_DICTIONARY[this.currentLanguage] || I18N_DICTIONARY['en-US'];
    const phraseText = langDict[phraseKey] || I18N_DICTIONARY['en-US'][phraseKey] || phraseKey;
    this.speak(phraseText, force);
  }

  /**
   * Voices raw text phrase directly.
   * 
   * @param {string} text
   * @param {boolean} [force=false]
   */
  speak(text, force = false) {
    if (!text || !('speechSynthesis' in window) || this.volume <= 0.01) {
      return;
    }

    const now = Date.now();

    if (!force && (now - this.lastSpokenTime < MIN_SPEECH_INTERVAL_MS)) {
      return;
    }

    if (text === this.lastSpokenText && (now - this.lastSpokenTime < 3200)) {
      return;
    }

    try {
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = this.currentLanguage;
      utterance.volume = this.volume;
      utterance.rate = this.rate;
      utterance.pitch = this.pitch;

      if (this.activeVoice) {
        utterance.voice = this.activeVoice;
      }

      this.lastSpokenText = text;
      this.lastSpokenTime = now;

      window.speechSynthesis.speak(utterance);
    } catch (error) {
      console.warn('VoiceCoach: Speech synthesis execution failed.', error);
    }
  }

  /**
   * Resets debounce timers and cancels active speech.
   */
  reset() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    this.lastSpokenText = '';
    this.lastSpokenTime = 0;
  }
}
