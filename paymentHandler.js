const plans = require("./plans");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function registerPaymentHandlers(bot, addCoins, getOrCreateUser) {
  bot.onText(/\/buy/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = String(msg.from.id);

    const user = await getOrCreateUser(telegramId);

    await bot.sendChatAction(chatId, "typing");

    let text = `💎 Buy Tokens\n\n`;
    text += `You currently have ${user.coins} tokens.\n`;
    text += `Each music generation costs 10 tokens.\n\n`;
    text += `Choose one of the packages below:\n\n`;

    for (const plan of plans) {
      text += `⭐ ${plan.name} — ${plan.coins} tokens — ${plan.stars} Stars\n${plan.description}\n\n`;
    }

    await bot.sendMessage(chatId, text, {
      reply_markup: {
        inline_keyboard: plans.map((plan) => [
          {
            text: `${plan.name} • ${plan.coins} tokens • ${plan.stars}⭐`,
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
          text: "Package not found.",
          show_alert: true,
        });
        return;
      }

      await bot.answerCallbackQuery(query.id, {
        text: "Preparing payment window...",
      });

      const loadingMessage = await bot.sendMessage(
        chatId,
        "💳 Opening payment window...\n▱▱▱▱▱▱▱▱▱▱"
      );

      await sleep(700);

      await bot.editMessageText(
        "💳 Preparing payment window...\n▰▰▰▱▱▱▱▱▱▱",
        {
          chat_id: chatId,
          message_id: loadingMessage.message_id,
        }
      );

      await sleep(700);

      await bot.editMessageText(
        "💳 Opening secure payment window...\n▰▰▰▰▰▰▰▰▰▰",
        {
          chat_id: chatId,
          message_id: loadingMessage.message_id,
        }
      );

      await sleep(500);

      await bot.sendInvoice(
        chatId,
        `${plan.name} Token Pack`,
        `${plan.coins} tokens. ${plan.description}`,
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
        await bot.sendMessage(chatId, "Payment received, but package not found.");
        return;
      }

      const paymentMessage = await bot.sendMessage(
        chatId,
        "💰 Verifying payment...\n▱▱▱▱▱▱▱▱▱▱"
      );

      await sleep(800);

      await bot.editMessageText(
        "💰 Updating balance...\n▰▰▰▰▱▱▱▱▱▱",
        {
          chat_id: chatId,
          message_id: paymentMessage.message_id,
        }
      );

      await addCoins(telegramId, plan.coins);

      const updatedUser = await getOrCreateUser(telegramId);

      await sleep(800);

      await bot.editMessageText(
        `✅ Payment received.\n${plan.coins} tokens have been added.\n\nCurrent balance: ${updatedUser.coins} tokens.`,
        {
          chat_id: chatId,
          message_id: paymentMessage.message_id,
        }
      );
    } catch (error) {
      console.error("SUCCESSFUL PAYMENT ERROR:", error);
      await bot.sendMessage(
        msg.chat.id,
        "Payment was received, but there was an error updating the balance. Please contact the admin."
      );
    }
  });
}

module.exports = registerPaymentHandlers;