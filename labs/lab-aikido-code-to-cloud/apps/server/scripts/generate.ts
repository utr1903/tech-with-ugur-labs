import { faker } from "@faker-js/faker";
import type { Biller, Card, Payment, Profile, ScheduledPayment } from "../src/data/s3";
import { withLuhnDigit } from "./luhn";

export const DEMO_USERS = [
  { username: "alice", customerId: "cus_0001" },
  { username: "bob", customerId: "cus_0002" },
  { username: "carol", customerId: "cus_0003" },
];
const DEMO_FIRST = ["Alice", "Bob", "Carol"];

const BILLERS: Array<[string, string, string]> = [
  ["Electricity Co", "utilities", "electricity-co.example.com"],
  ["Aqua Water Works", "utilities", "aqua-water.example.com"],
  ["CityGas Supply", "utilities", "citygas.example.com"],
  ["FiberNet Internet", "telecom", "fibernet.example.com"],
  ["Mobilo Wireless", "telecom", "mobilo.example.com"],
  ["Greenleaf Insurance", "insurance", "greenleaf-ins.example.com"],
  ["SafeHarbor Health", "insurance", "safeharbor.example.com"],
  ["Metro Transit Pass", "transport", "metrotransit.example.com"],
  ["Skyline Rentals", "housing", "skyline-rentals.example.com"],
  ["Hearth Mortgage", "housing", "hearth-mortgage.example.com"],
  ["StreamBox Video", "entertainment", "streambox.example.com"],
  ["TuneWave Music", "entertainment", "tunewave.example.com"],
  ["PowerFit Gym", "fitness", "powerfit.example.com"],
  ["BrightMinds Tuition", "education", "brightminds.example.com"],
  ["CityWaste Services", "municipal", "citywaste.example.com"],
];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const pad = (n: number, w = 4) => String(n).padStart(w, "0");

export function generateDataset(opts: { customers: number; seed: number; now: Date }): Map<string, unknown> {
  const { customers, seed, now } = opts;
  faker.seed(seed);
  const out = new Map<string, unknown>();

  const billers: Biller[] = BILLERS.map(([name, category, host]) => ({
    id: `bil_${slug(name)}`,
    name,
    category,
    website: `https://${host}`,
  }));
  out.set("billers.json", billers);
  const electricity = billers[0];
  const others = billers.slice(1);

  const start = new Date(now);
  start.setUTCMonth(start.getUTCMonth() - 12);

  for (let i = 1; i <= customers; i++) {
    const id = `cus_${pad(i)}`;
    const first = i <= DEMO_FIRST.length ? DEMO_FIRST[i - 1] : faker.person.firstName();
    const last = faker.person.lastName();
    const name = `${first} ${last}`;
    const profile: Profile = {
      id,
      name,
      email: `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, "") + "@paybuddy.example",
      phone: faker.phone.number(),
      address: `${faker.location.streetAddress()}, ${faker.location.city()}`,
      dateOfBirth: faker.date.birthdate({ min: 21, max: 75, mode: "age", refDate: now }).toISOString().slice(0, 10),
      nationalId: `9${faker.string.numeric(2)}-${faker.string.numeric(2)}-${faker.string.numeric(4)}`,
      iban: faker.finance.iban({ countryCode: "DE" }),
    };

    const cardCount = faker.number.int({ min: 1, max: 3 });
    const cards: Card[] = [];
    for (let c = 1; c <= cardCount; c++) {
      const prefix = faker.helpers.arrayElement(["400000", "555555"]);
      const pan = withLuhnDigit(prefix + faker.string.numeric(9));
      cards.push({
        id: `card_${c}`,
        brand: prefix === "400000" ? "VISA" : "MASTERCARD",
        pan,
        expiry: `${pad(faker.number.int({ min: 1, max: 12 }), 2)}/${faker.number.int({ min: 27, max: 31 })}`,
        cvv: faker.string.numeric(3),
        holderName: name.toUpperCase(),
      });
    }

    const payments: Array<Omit<Payment, "id">> = [];
    const mk = (date: Date, b: Biller, amount: number): Omit<Payment, "id"> => ({
      date: date.toISOString(),
      billerId: b.id,
      billerName: b.name,
      amount,
      currency: "EUR",
      cardLast4: faker.helpers.arrayElement(cards).pan.slice(-4),
      status: faker.helpers.weightedArrayElement([
        { weight: 90, value: "completed" },
        { weight: 6, value: "pending" },
        { weight: 4, value: "failed" },
      ]),
    });
    // one electricity payment in each of the last 12 calendar months (months 0..11 back from now)
    for (let m = 0; m < 12; m++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - m, 2, 9, 0, 0));
      payments.push(mk(d, electricity, faker.number.int({ min: 4000, max: 18000 }) / 100));
    }
    const extra = faker.number.int({ min: 33, max: 43 });
    for (let n = 0; n < extra; n++) {
      const d = faker.date.between({ from: new Date(start.getTime() + 86400000), to: now });
      payments.push(mk(d, faker.helpers.arrayElement(others), faker.number.int({ min: 500, max: 25000 }) / 100));
    }
    payments.sort((a, b) => a.date.localeCompare(b.date));
    const withIds: Payment[] = payments.map((p, n) => ({ id: `pay_${pad(i)}_${pad(n + 1)}`, ...p }));

    const scheduled: ScheduledPayment[] = [];
    out.set(`customers/${id}/profile.json`, profile);
    out.set(`customers/${id}/cards.json`, cards);
    out.set(`customers/${id}/payments.json`, withIds);
    out.set(`customers/${id}/scheduled-payments.json`, scheduled);
  }

  out.set("internal/fraud-rules.json", {
    note: "FAKE demo data",
    rules: [
      { id: "fr_1", description: "Block single payment above EUR 10000", threshold: 10000 },
      { id: "fr_2", description: "Flag more than 5 payments per hour", threshold: 5 },
      { id: "fr_3", description: "Flag first payment to new biller above EUR 2000", threshold: 2000 },
    ],
  });
  out.set(
    "internal/admin-credentials.txt",
    `FAKE demo credentials - not real\nusername: admin\npassword: Adm1n-${faker.string.alphanumeric(10)}\n`,
  );
  out.set(
    "internal/README.txt",
    "PayBuddy internal ops notes (FAKE demo data).\nThis prefix holds fraud rules and admin credentials. Staff only.\n",
  );
  return out;
}
