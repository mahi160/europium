import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import bn from './locales/bn.json';
import en from './locales/en.json';
void i18n.use(initReactI18next).init({
  resources: { bn: { translation: bn }, en: { translation: en } },
  lng: localStorage.getItem('office-language') === 'en' ? 'en' : 'bn',
  fallbackLng: 'bn',
  interpolation: { escapeValue: false },
});
export function applyLanguage(language: string) {
  void i18n.changeLanguage(language);
  localStorage.setItem('office-language', language);
  document.documentElement.lang = language === 'en' ? 'en' : 'bn-BD';
  document.title = i18n.t('app');
}
export function number(value: number) {
  const english = i18n.language === 'en';
  return new Intl.NumberFormat(english ? 'en-BD' : 'bn-BD', {
    numberingSystem: english ? 'latn' : 'beng',
  }).format(value);
}
export function localDigits(value: string) {
  return i18n.language === 'en' ? value : value.replace(/[0-9]/g, (digit) => number(Number(digit)));
}
export function date(value: number | string) {
  const english = i18n.language === 'en';
  return new Intl.DateTimeFormat(english ? 'en-BD' : 'bn-BD', {
    timeZone: 'Asia/Dhaka',
    dateStyle: 'medium',
    timeStyle: 'short',
    numberingSystem: english ? 'latn' : 'beng',
    ...(english ? {} : { hourCycle: 'h23' }),
  }).format(new Date(value));
}
export default i18n;
