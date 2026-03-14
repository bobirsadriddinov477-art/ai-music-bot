const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.join(__dirname, "bot.sqlite");
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      telegram_id TEXT PRIMARY KEY,
      coins INTEGER NOT NULL DEFAULT 30,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

function getUser(telegramId) {
  return new Promise((resolve, reject) => {
    db.get(
      "SELECT * FROM users WHERE telegram_id = ?",
      [telegramId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row);
      }
    );
  });
}

function createUser(telegramId) {
  return new Promise((resolve, reject) => {
    db.run(
      "INSERT OR IGNORE INTO users (telegram_id, coins) VALUES (?, 30)",
      [telegramId],
      function (err) {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

async function getOrCreateUser(telegramId) {
  let user = await getUser(telegramId);

  if (!user) {
    await createUser(telegramId);
    user = await getUser(telegramId);
  }

  return user;
}

function updateCoins(telegramId, coins) {
  return new Promise((resolve, reject) => {
    db.run(
      "UPDATE users SET coins = ? WHERE telegram_id = ?",
      [coins, telegramId],
      function (err) {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

async function deductCoins(telegramId, amount) {
  const user = await getOrCreateUser(telegramId);

  if (user.coins < amount) {
    return { success: false, coins: user.coins };
  }

  const newCoins = user.coins - amount;
  await updateCoins(telegramId, newCoins);

  return { success: true, coins: newCoins };
}

async function addCoins(telegramId, amount) {
  const user = await getOrCreateUser(telegramId);
  const newCoins = user.coins + amount;

  await updateCoins(telegramId, newCoins);

  return { success: true, coins: newCoins };
}

module.exports = {
  getOrCreateUser,
  deductCoins,
  addCoins,
  updateCoins,
};