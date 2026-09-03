const express = require('express');
const fetch = require('node-fetch');
const cron = require('node-cron');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// === КОНФИГУРАЦИЯ ===
const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID;
const ONESIGNAL_API_KEY = process.env.ONESIGNAL_API_KEY;
const GIST_ID = process.env.GIST_ID;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// Если переменные не заданы – используем тестовые значения (только для отладки)
const FALLBACK_START_DATE = '2026-08-29';
const FALLBACK_TOTAL_DAYS = 280;

// === ФУНКЦИЯ ДЛЯ ЗАГРУЗКИ НАСТРОЕК ИЗ GIST ===
async function loadSettingsFromGist() {
  if (!GIST_ID || !GITHUB_TOKEN) {
    console.log('ℹ️ Gist не настроен. Используем значения по умолчанию.');
    return {
      startDate: FALLBACK_START_DATE,
      totalDays: FALLBACK_TOTAL_DAYS
    };
  }
  try {
    const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
      headers: { 'Authorization': `Bearer ${GITHUB_TOKEN}` }
    });
    if (!res.ok) throw new Error('Ошибка загрузки Gist');
    const data = await res.json();
    if (data.files && data.files['bible_settings.json']) {
      const settings = JSON.parse(data.files['bible_settings.json'].content);
      return {
        startDate: settings.startDate || FALLBACK_START_DATE,
        totalDays: settings.totalDays || FALLBACK_TOTAL_DAYS
      };
    }
  } catch (e) {
    console.error('❌ Ошибка загрузки настроек из Gist:', e.message);
  }
  return {
    startDate: FALLBACK_START_DATE,
    totalDays: FALLBACK_TOTAL_DAYS
  };
}

// === ФУНКЦИЯ ДЛЯ ОТПРАВКИ PUSH-УВЕДОМЛЕНИЯ ===
async function sendPushNotification(message, heading = '📖 Трекер Библии') {
  if (!ONESIGNAL_APP_ID || !ONESIGNAL_API_KEY) {
    console.warn('⚠️ OneSignal API ключи не заданы. Уведомление не отправлено.');
    return;
  }
  const body = {
    app_id: ONESIGNAL_APP_ID,
    included_segments: ['All'],
    headings: { en: heading },
    contents: { en: message },
    url: 'https://ILYA-MRK.github.io/bible-tracker' // ссылка на ваше приложение
  };
  try {
    const res = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${ONESIGNAL_API_KEY}`
      },
      body: JSON.stringify(body)
    });
    const result = await res.json();
    if (res.ok) {
      console.log('✅ Уведомление отправлено:', result);
    } else {
      console.error('❌ Ошибка отправки:', result);
    }
  } catch (e) {
    console.error('❌ Ошибка при отправке уведомления:', e.message);
  }
}

// === ГЛАВНАЯ ФУНКЦИЯ ПРОВЕРКИ ===
async function checkPeriodsAndNotify() {
  console.log('🔍 Проверка периодов...');
  const settings = await loadSettingsFromGist();
  const startDate = new Date(settings.startDate);
  const totalDays = settings.totalDays;
  const totalChapters = 1189;
  const periodDays = 10;
  const today = new Date();
  today.setHours(0,0,0,0);

  // Вычисляем номер текущего периода
  const diffDays = Math.floor((today - startDate) / (1000 * 60 * 60 * 24));
  if (diffDays < 0 || diffDays >= totalDays) {
    console.log('ℹ️ План ещё не начался или уже завершён.');
    return;
  }
  const periodIndex = Math.floor(diffDays / periodDays);
  const periods = [];
  for (let i = 0; i < Math.ceil(totalDays / periodDays); i++) {
    const pStart = new Date(startDate);
    pStart.setDate(startDate.getDate() + i * periodDays);
    const pEnd = new Date(pStart);
    const daysInPeriod = Math.min(periodDays, totalDays - i * periodDays);
    pEnd.setDate(pStart.getDate() + daysInPeriod - 1);
    periods.push({ start: pStart, end: pEnd });
  }
  const currentPeriod = periods[periodIndex];
  if (!currentPeriod) return;

  // Сколько дней осталось до конца текущего периода
  const endDate = new Date(currentPeriod.end);
  endDate.setHours(0,0,0,0);
  const remainingDays = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));

  let message = '';
  if (remainingDays === 5) {
    message = '⏳ До окончания периода осталось 5 дней! Успейте прочитать запланированное.';
  } else if (remainingDays === 3) {
    message = '⏳ До окончания периода осталось 3 дня! Не откладывайте чтение.';
  } else if (remainingDays === 1) {
    message = '⚠️ Завтра последний день периода! Успейте выполнить план.';
  } else if (remainingDays === 0) {
    message = '📢 Сегодня последний день периода! Проверьте свой прогресс.';
  } else {
    console.log(`ℹ️ До конца периода ${remainingDays} дней. Уведомление не требуется.`);
    return;
  }

  // Отправляем уведомление
  await sendPushNotification(message);
}

// === ЗАПУСК ПО РАСПИСАНИЮ (каждый день в 10:00) ===
cron.schedule('0 10 * * *', () => {
  console.log('⏰ Запуск по расписанию...');
  checkPeriodsAndNotify();
});

// === ЗАПУСК ПРИ СТАРТЕ СЕРВЕРА ===
checkPeriodsAndNotify();

// === ЭНДПОИНТ ДЛЯ РУЧНОГО ВЫЗОВА ===
app.get('/check', async (req, res) => {
  await checkPeriodsAndNotify();
  res.send('Проверка выполнена');
});

app.get('/', (req, res) => {
  res.send('Bible Tracker Server is running');
});

app.listen(PORT, () => {
  console.log(`✅ Сервер запущен на порту ${PORT}`);
  console.log(`ℹ️ OneSignal App ID: ${ONESIGNAL_APP_ID ? '✅ задан' : '❌ не задан'}`);
  console.log(`ℹ️ OneSignal API Key: ${ONESIGNAL_API_KEY ? '✅ задан' : '❌ не задан'}`);
  console.log(`ℹ️ Gist ID: ${GIST_ID ? '✅ задан' : '❌ не задан (используем значения по умолчанию)'}`);
});