import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import fr from './locales/fr.json'
import de from './locales/de.json'
import es from './locales/es.json'
import pt from './locales/pt.json'
import it from './locales/it.json'
import nl from './locales/nl.json'
import pl from './locales/pl.json'
import hi from './locales/hi.json'
import zh from './locales/zh.json'
import ar from './locales/ar.json'
import ja from './locales/ja.json'
import id from './locales/id.json'
import yo from './locales/yo.json'
import th from './locales/th.json'
import vi from './locales/vi.json'

const LANG_KEY = 'silicon-studio-language'

i18n.use(initReactI18next).init({
    resources: {
        en: { translation: en },
        fr: { translation: fr },
        de: { translation: de },
        es: { translation: es },
        pt: { translation: pt },
        it: { translation: it },
        nl: { translation: nl },
        pl: { translation: pl },
        hi: { translation: hi },
        zh: { translation: zh },
        ar: { translation: ar },
        ja: { translation: ja },
        id: { translation: id },
        yo: { translation: yo },
        th: { translation: th },
        vi: { translation: vi },
    },
    lng: localStorage.getItem(LANG_KEY) || 'en',
    fallbackLng: 'en',
    interpolation: {
        escapeValue: false, // React already escapes
    },
})

// Persist language choice
i18n.on('languageChanged', (lng) => {
    localStorage.setItem(LANG_KEY, lng)
})

export default i18n
