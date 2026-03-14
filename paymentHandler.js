const plans = require("./plans");

function registerPaymentHandlers(bot, addCoins, getOrCreateUser) {
  bot.onText(/\/buy/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = String(msg.from.id);

    const user = await getOrCreateUser(telegramId);

    let text = `💎 Token sotib olish\n\n`;
    text += `Sizda hozir ${user.coins} token bor.\n`;
    text += `Har bir music generation — 10 token.\n\n`;
    text += `Quyidagi paketlardan birini tanlang:\n\n`;

    for (const plan of plans) {
      text += `⭐ ${plan.name} — ${plan.coins} token — ${plan.stars} Stars\n${plan.description}\n\n`;
    }

    await bot.sendMessage(chatId, text, {
      reply_markup: {
        inline_keyboard: plans.map((plan) => [
          {
            text: `${plan.name} • ${plan.coins} token • ${plan.stars}⭐`,
            callback_data: `buy_${plan.id}`,
          },
        ]),
      },
    });
  });

  bot.on("callback_query", async (query) => {
    try {
      const data = query.data || "";
      if (!data.startsWith("buy_")) return;

      const chatId = query.message.chat.id;
      const planId = data.replace("buy_", "");
      const plan = plans.find((p) => p.id === planId);

      if (!plan) {
        await bot.answerCallbackQuery(query.id, {
          text: "Paket topilmadi.",
          show_alert: true,
        });
        return;
      }

      await bot.answerCallbackQuery(query.id);

      await bot.sendInvoice(
        chatId,
        `${plan.name} Token Pack`,
        `${plan.coins} token. ${plan.description}`,
        plan.id,
        "",
        "XTR",
        [
          {
            label: plan.label,
            amount: plan.stars,
          },
        ]
      );
    } catch (error) {
      console.error("PAYMENT CALLBACK ERROR:", error);
    }
  });

  bot.on("successful_payment", async (msg) => {
    try {
      const chatId = msg.chat.id;
      const telegramId = String(msg.from.id);
      const payload = msg.successful_payment.invoice_payload;

      const plan = plans.find((p) => p.id === payload);
      if (!plan) {
        await bot.sendMessage(chatId, "To‘lov qabul qilindi, lekin paket topilmadi.");
        return;
      }

      await addCoins(telegramId, plan.coins);

      const updatedUser = await getOrCreateUser(telegramId);

      await bot.sendMessage(
        chatId,
        `✅ To‘lov qabul qilindi.\n${plan.coins} token qo‘shildi.\n\nHozirgi balans: ${updatedUser.coins} token.`
      );
    } catch (error) {
      console.error("SUCCESSFUL PAYMENT ERROR:", error);
      await bot.sendMessage(
        msg.chat.id,
        "To‘lov qabul qilindi, lekin balansni yangilashda xatolik bo‘ldi. Admin bilan bog‘laning."
      );
    }
  });
}

module.exports = registerPaymentHandlers;