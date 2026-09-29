const path = require('node:path');

const brand = 'Lavener Holdings';
const assetRoot = path.join(__dirname, '../assets/email');
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

function presentation(key = '') {
  if (key.startsWith('completed-invoice:')) return { title: 'Your paid invoice', label: 'Paid in full', color: '#267455' };
  if (key.startsWith('payment:')) return { title: 'Payment recorded', label: 'Payment update', color: '#267455' };
  if (key.startsWith('overdue:')) return { title: 'Subscription overdue', label: 'Action required', color: '#a52d35' };
  if (key.startsWith('invoice:')) {
    if (key.includes(':paid:')) return { title: 'Payment recorded', label: 'Paid', color: '#267455' };
    if (key.includes(':void:')) return { title: 'Bill cancelled', label: 'Void', color: '#69717d' };
    return { title: 'Your subscription bill', label: 'Payment due', color: '#8a6327' };
  }
  if (key.startsWith('school:')) return { title: 'Welcome to School Setu', label: 'School created', color: '#267455' };
  if (key.startsWith('subscription:')) return { title: 'Subscription updated', label: 'Account update', color: '#14213d' };
  return { title: 'School Setu account update', label: 'Notification', color: '#14213d' };
}

function render(mail) {
  const display = presentation(mail.key);
  const rows = [];
  const paragraphs = [];
  for (const line of String(mail.text || '').split('\n').filter(line => line.trim())) {
    const match = line.match(/^([A-Za-z][A-Za-z ]{0,30}):\s*(.+)$/);
    if (match) rows.push(`<tr><td style="padding:13px 12px;border-bottom:1px solid #e4e4de;color:#69717d;width:40%;vertical-align:top;font-size:13px">${escape(match[1])}</td><td style="padding:13px 12px;border-bottom:1px solid #e4e4de;color:#202b40;font-size:14px;overflow-wrap:anywhere">${escape(match[2])}</td></tr>`);
    else paragraphs.push(`<p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#505866;overflow-wrap:anywhere">${escape(line)}</p>`);
  }
  const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(mail.subject)}</title>
<style>@media only screen and (max-width:600px){.outer{padding:12px 8px!important}.content{padding:24px 18px!important}.brand-cell{padding:24px 18px!important}.wordmark{width:190px!important;max-width:100%!important}}</style></head>
<body style="margin:0;padding:0;background:#f7f6f2;font-family:Arial,Helvetica,sans-serif;color:#202b40">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${escape(mail.subject)} | ${brand}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f6f2"><tr><td class="outer" align="center" style="padding:32px 16px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-top:4px solid #d7b16b">
<tr><td class="brand-cell" style="padding:28px 32px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="padding-right:18px"><img src="cid:lavener-symbol" alt="" width="42" height="48" style="display:block;border:0"></td>
<td><img class="wordmark" src="cid:lavener-wordmark" alt="Lavener Holdings" width="260" style="display:block;width:260px;max-width:100%;height:auto;border:0"></td>
</tr></table></td></tr>
<tr><td class="content" style="padding:28px 32px;background:#14213d;color:#ffffff">
<p style="margin:0 0 12px;font-size:12px;color:#d7b16b">SCHOOL SETU ERP</p>
<h1 style="margin:0;font-size:26px;font-weight:500;line-height:1.3;overflow-wrap:anywhere">${display.title}</h1>
</td></tr>
<tr><td class="content" style="padding:32px">
<span style="display:inline-block;padding:6px 10px;background:#f7f6f2;color:${display.color};font-size:12px;font-weight:bold">${display.label}</span>
<h2 style="font-size:18px;font-weight:600;line-height:1.5;margin:20px 0;color:#202b40;overflow-wrap:anywhere">${escape(mail.subject)}</h2>
${rows.length ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%;table-layout:fixed;border-top:1px solid #e4e4de;margin-bottom:24px">${rows.join('')}</table>` : ''}
${paragraphs.join('')}
<p style="margin:24px 0 0;padding-top:20px;border-top:1px solid #e4e4de;font-size:13px;line-height:1.7;color:#69717d">For billing details and account actions, open your School Setu dashboard.</p>
</td></tr>
<tr><td class="content" style="padding:24px 32px;background:#f7f6f2;border-top:1px solid #e4e4de">
<p style="margin:0 0 6px;font-size:13px;color:#14213d;font-weight:bold">${brand}</p>
<p style="margin:0 0 12px;font-size:12px;line-height:1.6;color:#69717d">School Setu ERP is part of ${brand}.</p>
<p style="margin:0 0 12px;font-size:12px;line-height:1.6"><a href="https://lavener.com" style="color:#14213d">lavener.com</a> &nbsp; | &nbsp; <a href="mailto:lavenergroup@gmail.com" style="color:#14213d">Contact support</a></p>
<p style="margin:0;font-size:11px;line-height:1.6;color:#69717d">This is an automated service notification. Please do not reply to this email.</p>
</td></tr></table></td></tr></table></body></html>`;
  return {
    html,
    text: `${brand}\nSchool Setu ERP\n\n${mail.subject}\n\n${mail.text || ''}\n\nOpen your School Setu dashboard for account actions.\nSchool Setu ERP is part of ${brand}.\nSupport: lavenergroup@gmail.com | https://lavener.com\nThis is an automated notification. Please do not reply.`,
    attachments: [
      { filename: 'lavener-symbol.png', path: path.join(assetRoot, 'lavener-symbol.png'), cid: 'lavener-symbol', contentDisposition: 'inline' },
      { filename: 'lavener-wordmark.png', path: path.join(assetRoot, 'lavener-wordmark.png'), cid: 'lavener-wordmark', contentDisposition: 'inline' },
    ],
  };
}

module.exports = { render };
