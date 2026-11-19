(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const STORAGE = 'duofit-v1-submissions';
  const CONFIG = 'duofit-v1-config';
  const mealNames = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '加餐' };
  const weightNames = { raw: '生重', cooked: '熟重', edible: '可食部分', unknown: '不确定' };
  let meal = 'lunch';
  let items = [];
  const getRecords = () => { try { return JSON.parse(localStorage.getItem(STORAGE) || '[]'); } catch { return []; } };
  const config = () => { try { return JSON.parse(localStorage.getItem(CONFIG) || '{}'); } catch { return {}; } };
  const persist = (records) => localStorage.setItem(STORAGE, JSON.stringify(records));
  const localDate = () => { const d = new Date(); const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }); return f.format(d); };
  $('date').value = localDate();
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Shanghai' }).format(new Date()));
  meal = hour < 10 ? 'breakfast' : hour < 15 ? 'lunch' : hour < 21 ? 'dinner' : 'snack';
  const escapeHTML = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  function renderMeal() { document.querySelectorAll('#meals button').forEach((b) => { b.classList.toggle('active', b.dataset.value === meal); b.setAttribute('aria-pressed', String(b.dataset.value === meal)); }); }
  document.querySelectorAll('#meals button').forEach((b) => b.addEventListener('click', () => { meal = b.dataset.value; renderMeal(); }));
  renderMeal();
  function renderItems() {
    $('count').textContent = `${items.length} 项`;
    $('submit').disabled = !items.length;
    $('items').innerHTML = items.length ? items.map((item, index) => `<div class="item"><div><div class="item-name">${escapeHTML(item.name)} · ${item.weight_g} g</div><div class="item-meta">${weightNames[item.weight_kind]}${item.oily ? ' · 偏油' : ''}${item.rinsed ? ' · 涮水' : ''}${item.note ? ' · ' + escapeHTML(item.note) : ''}</div></div><button class="remove" data-index="${index}" type="button" aria-label="移除${escapeHTML(item.name)}">移除</button></div>`).join('') : '<div class="empty">还没有添加食物</div>';
    $('items').querySelectorAll('.remove').forEach((b) => b.addEventListener('click', () => { items.splice(Number(b.dataset.index), 1); renderItems(); }));
  }
  $('food-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const name = $('food').value.trim();
    const weight = Number($('weight').value);
    if (!name || !Number.isFinite(weight) || weight <= 0 || weight > 100000) return;
    items.push({ name, weight_g: weight, weight_kind: $('weight-kind').value, oily: $('oily').checked, rinsed: $('rinsed').checked, note: $('note').value.trim() });
    $('food-form').reset(); $('food').focus(); renderItems();
  });
  async function sendRecord(record) {
    const { apiUrl, token } = config();
    if (!apiUrl) return false;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${apiUrl.replace(/\/+$/, '')}/api/submissions`, { method: 'POST', headers, body: JSON.stringify({ id: record.id, person: 'partner', date: record.date, meal: record.meal, items: record.items, submitted_at: record.created_at }) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return true;
  }
  async function syncRecord(id) {
    const records = getRecords(); const record = records.find((r) => r.id === id);
    if (!record || record.state === 'sent') return;
    try { if (await sendRecord(record)) { record.state = 'sent'; record.error = ''; } else { record.state = 'local'; } }
    catch (e) { record.state = 'error'; record.error = e.message; }
    persist(records); renderHistory();
  }
  $('submit').addEventListener('click', async () => {
    const id = crypto.randomUUID();
    const record = { id, person: 'partner', date: $('date').value, meal, items: structuredClone(items), created_at: new Date().toISOString(), state: 'local' };
    if (!record.date) { $('status').textContent = '请选择日期'; return; }
    const records = getRecords(); records.unshift(record); persist(records);
    items = []; renderItems(); renderHistory(); await syncRecord(id);
    const latest = getRecords().find((r) => r.id === id);
    $('status').textContent = latest.state === 'sent' ? '已提交到 API，等待后续处理。' : latest.state === 'error' ? `已保存在本机；上传失败（${latest.error}），稍后可以重试。` : '已保存在本机。API 上线后可在下方重试上传。';
  });
  function renderHistory() {
    const records = getRecords();
    $('history-list').innerHTML = records.length ? records.map((r) => `<div class="history-entry"><div class="history-head"><strong>${escapeHTML(r.date)} · ${mealNames[r.meal]}</strong><span class="state ${r.state === 'sent' ? 'sent' : ''}">${r.state === 'sent' ? '已提交' : r.state === 'error' ? '上传失败' : '仅本机'}</span></div><small>${r.items.map((i) => `${escapeHTML(i.name)} ${i.weight_g}g`).join('、')}</small><div class="history-actions">${r.state !== 'sent' ? `<button type="button" data-retry="${r.id}">重试上传</button><button type="button" data-delete="${r.id}">删除草稿</button>` : ''}</div></div>`).join('') : '<div class="empty">暂无草稿</div>';
    $('history-list').querySelectorAll('[data-retry]').forEach((b) => b.addEventListener('click', () => syncRecord(b.dataset.retry)));
    $('history-list').querySelectorAll('[data-delete]').forEach((b) => b.addEventListener('click', () => { if (confirm('删除这个尚未上传的本地草稿？')) { persist(getRecords().filter((r) => r.id !== b.dataset.delete)); renderHistory(); } }));
  }
  $('refresh').addEventListener('click', renderHistory);
  const initial = config(); $('api-url').value = initial.apiUrl || ''; $('api-token').value = initial.token || '';
  function updateConnection() { const connected = !!config().apiUrl; $('connection').textContent = connected ? 'API 已配置' : '本地草稿'; $('connection').classList.toggle('live', connected); }
  $('save-settings').addEventListener('click', () => { const apiUrl = $('api-url').value.trim(); if (apiUrl && !/^https:\/\//.test(apiUrl)) { alert('API 地址必须以 https:// 开头'); return; } localStorage.setItem(CONFIG, JSON.stringify({ apiUrl, token: $('api-token').value.trim() })); updateConnection(); alert('连接设置已保存；填写地址不代表 API 已通过验证。'); });
  updateConnection(); renderItems(); renderHistory();
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
})();
