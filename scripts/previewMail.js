const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { render } = require('../src/services/emailTemplate');

async function main() {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'lavener-email-preview-'));
  const fixtures = {
    welcome: { key: 'school:demo:recipient', subject: 'Green Valley School: school subscription created', text: 'School Green Valley School (green-valley) has been created with 2 branches.\nCycle: quarterly\nCycle price: INR 12000.00\nMonthly maintenance: INR 1000.00\nFirst bill: 2026-10-01\nBills are due 15 days after generation.' },
    subscription: { key: 'subscription:demo:recipient', subject: 'Green Valley School: subscription updated', text: 'Cycle: annually\nCycle price: INR 48000.00\nMonthly maintenance: INR 1000.00\nFirst bill: 2026-10-01\nBills are due 15 days after generation.' },
    bill: { key: 'invoice:demo:unpaid:recipient', subject: 'Green Valley School: bill INV-DEMO-001 unpaid', text: 'School: Green Valley School (green-valley)\nBill: INV-DEMO-001\nQuarterly ERP subscription (2026-10-01)\nAmount: INR 15000.00\nDue: 2026-10-16 (IST)\nStatus: unpaid\nPlease arrange payment by the due date. Unpaid overdue bills suspend ERP access for all branches.' },
    paid: { key: 'invoice:demo:paid:recipient', subject: 'Green Valley School: bill INV-DEMO-001 paid', text: 'School: Green Valley School (green-valley)\nBill: INV-DEMO-001\nAmount: INR 15000.00\nStatus: paid\nPayment has been recorded for this bill.' },
    void: { key: 'invoice:demo:void:recipient', subject: 'Green Valley School: bill INV-DEMO-001 void', text: 'Bill: INV-DEMO-001\nStatus: void\nThis bill has been cancelled. No payment is required for this bill.' },
    overdue: { key: 'overdue:demo:recipient', subject: 'Green Valley School: subscription overdue', text: 'Bill INV-DEMO-001 for INR 15000.00 was due 2026-10-16. ERP access is suspended until payment is recorded.' },
  };
  for (const [name, fixture] of Object.entries(fixtures)) {
    const mail = render(fixture);
    let html = mail.html;
    for (const asset of mail.attachments) {
      html = html.replace(`cid:${asset.cid}`, `data:image/png;base64,${(await fs.readFile(asset.path)).toString('base64')}`);
    }
    await fs.writeFile(path.join(folder, `${name}.html`), html);
  }
  console.log(folder);
}

main().catch(() => { console.error('Could not generate email previews.'); process.exitCode = 1; });
