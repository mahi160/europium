import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import bn from './locales/bn.json';
import en from './locales/en.json';
void i18n.use(initReactI18next).init({
  resources: { bn: { translation: bn }, en: { translation: en } },
  lng: localStorage.getItem('office-language') === 'en' ? 'en' : 'bn',
  fallbackLng: 'bn', interpolation: { escapeValue: false },
});
export function applyLanguage(language: string) {
  void i18n.changeLanguage(language);
  localStorage.setItem('office-language', language);
  document.documentElement.lang = language === 'en' ? 'en' : 'bn-BD';
  document.title = i18n.t('app');
}
export function number(value: number) {
  const english = i18n.language === 'en';
  return new Intl.NumberFormat(english ? 'en-BD' : 'bn-BD', { numberingSystem: english ? 'latn' : 'beng' }).format(value);
}
export function date(value: number | string) {
  return new Intl.DateTimeFormat(i18n.language === 'en' ? 'en-BD' : 'bn-BD', { timeZone: 'Asia/Dhaka', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
export default i18n;
