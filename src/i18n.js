import { languages, messages } from './locales/ui.js';

export { languages };

export function formatMessage(template, params = {}) {
  return String(template ?? '').replace(/\{(\w+)\}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match
  ));
}

export function resolveMessage(value, language, params = {}) {
  const localized = typeof value === 'string' && messages[value] ? messages[value] : value;
  if (typeof localized === 'string') return formatMessage(localized, params);
  const template = localized?.[language] ?? localized?.en ?? Object.values(localized ?? {})[0] ?? '';
  const localizedParams = Object.fromEntries(Object.entries(params).map(([key, parameter]) => {
    if ((typeof parameter === 'string' && messages[parameter]) || (parameter && typeof parameter === 'object')) {
      return [key, resolveMessage(parameter, language)];
    }
    return [key, parameter];
  }));
  return formatMessage(template, localizedParams);
}

export function localizedError(key, params = {}) {
  const error = new Error(key);
  error.translationKey = key;
  error.translationParams = params;
  return error;
}

export function translateError(error, translate) {
  if (error?.translationKey) return translate(error.translationKey, error.translationParams);
  return error?.message ?? String(error);
}
