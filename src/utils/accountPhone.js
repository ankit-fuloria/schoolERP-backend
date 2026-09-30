const separators = '[\\s().-]*';

function digits(value) {
  if (typeof value !== 'string' || !/^\+?[\d\s().-]+$/.test(value.trim())) return '';
  const result = value.replace(/\D/g, '');
  if (result.length === 12 && result.startsWith('91')) return result.slice(2);
  if (result.length === 11 && result.startsWith('0')) return result.slice(1);
  return result;
}

function pattern(value) {
  const number = digits(value);
  if (number.length < 7 || number.length > 15) return null;
  const prefix = number.length === 10 ? `(?:\\+?91${separators}|0${separators})?` : '\\+?';
  return new RegExp(`^${prefix}${number.split('').join(separators)}$`);
}

function required(value) {
  const number = digits(value);
  if (number.length < 7 || number.length > 15) {
    const error = new Error('Phone must contain 7-15 digits');
    error.status = 400;
    throw error;
  }
  return number;
}

module.exports = { digits, pattern, required };
