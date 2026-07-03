export const MessageTemplates = {
  deliveryCompleted: (
    customerName: string,
    productName: string,
    qty: number,
    cashCollected: number,
  ) =>
    `Assalam o Alaikum ${customerName}! ✅\n\nAapki delivery complete hui:\n🔵 Product: ${productName}\n🫙 Quantity: ${qty} bottles\n💰 Cash Collected: Rs. ${cashCollected}\n\nShukriya!`,

  paymentReceived: (
    customerName: string,
    amount: number,
    remainingBalance: number,
  ) =>
    `Assalam o Alaikum ${customerName}! 💚\n\nAapki payment receive hui:\n💰 Amount: Rs. ${amount}\n📊 Remaining Balance: Rs. ${remainingBalance.toFixed(2)}\n\nShukriya apna business karne ke liye!`,

  balanceReminder: (customerName: string, balance: number) =>
    `Assalamu Alaikum, ${customerName}\n\nThis is a friendly reminder about your outstanding balance of Rs. ${balance.toFixed(2)}.\n\nWe would appreciate your prompt payment.\n\nThank you for choosing Blue Ice.`,

  balanceReminderWithStatement: (
    customerName: string,
    balance: number,
    month: string,
    statementUrl: string,
  ) =>
    `Assalam o Alaikum ${customerName},\n\nYe aapka ${month} ka balance reminder hai:\n💰 Due Amount: Rs. ${balance.toFixed(2)}\n\n📄 Aapka maheena ka statement yahan dekhen:\n${statementUrl}\n\nKindly jald payment karein. Shukriya!`,

  balanceReminderWithAttachedStatement: (
    customerName: string,
    balance: number,
  ) =>
    `Assalamu Alaikum, ${customerName}\n\nPlease find your invoice attached.\n\nKindly review the invoice for your account details and current balance Rs. ${balance.toFixed(2)}.\n\nWe would appreciate your prompt payment.\n\nThank you for choosing Blue Ice.`,

  /** Balance is 0 (or in advance) — no payment ask, just a friendly confirmation */
  balanceClear: (customerName: string, balance: number) =>
    `Assalamu Alaikum, ${customerName}\n\n${
      balance < 0
        ? `There is no outstanding balance on your account.\nYou have an advance credit of Rs. ${Math.abs(balance).toFixed(2)}.`
        : 'Your account is all clear — there is no outstanding balance.'
    }\n\nThank you for choosing Blue Ice.`,

  /** Statement PDF attached for a customer whose balance is 0 (or in advance) */
  statementWithClearBalance: (customerName: string, month: string, balance: number) =>
    `Assalamu Alaikum, ${customerName}\n\nPlease find your ${month} statement attached.\n\n${
      balance < 0
        ? `There is no outstanding balance on your account.\nYou have an advance credit of Rs. ${Math.abs(balance).toFixed(2)}.`
        : 'There is no outstanding balance on your account — it is all clear.'
    }\n\nThank you for choosing Blue Ice.`,

  deliveryScheduled: (customerName: string, date: string) =>
    `Assalam o Alaikum ${customerName}! 📅\n\nAapki delivery schedule hui hai:\n📆 Date: ${date}\n\nDriver aapke ghar aayega. Shukriya!`,

  orderApproved: (customerName: string, productName: string, qty: number) =>
    `Assalam o Alaikum ${customerName}! ✅\n\nAapka order approve ho gaya:\n🔵 Product: ${productName}\n🫙 Quantity: ${qty}\n\nHum jald delivery karenge. Shukriya!`,

  orderRejected: (customerName: string, productName: string, reason?: string) =>
    `Assalam o Alaikum ${customerName},\n\nAfsos! Aapka order reject ho gaya:\n🔵 Product: ${productName}${reason ? `\n❌ Reason: ${reason}` : ''}\n\nKoi sawaal ho toh support se rabta karein.`,

  ticketReplied: (customerName: string, subject: string) =>
    `Assalam o Alaikum ${customerName}! 💬\n\nAapke ticket ka jawab aa gaya:\n📋 Subject: ${subject}\n\nPortal mein check karein. Shukriya!`,

  orderPlanned: (customerName: string, productName: string, qty: number, date: string) =>
    `Assalam o Alaikum ${customerName}! 📅\n\nAapka order plan ho gaya:\n🔵 Product: ${productName}\n🫙 Quantity: ${qty}\n📆 Delivery Date: ${date}\n\nHum waqt par aayenge. Shukriya!`,

  orderDispatched: (customerName: string, productName: string, qty: number) =>
    `Assalam o Alaikum ${customerName}! 🚚\n\nAapka order aaj deliver ho raha hai:\n🔵 Product: ${productName}\n🫙 Quantity: ${qty}\n\nDriver raaste mein hai. Shukriya!`,

  deliveryCorrected: (
    customerName: string,
    productName: string,
    qty: number,
    cashCollected: number,
  ) =>
    `Assalam o Alaikum ${customerName},\n\n⚠️ Maafi chahte hain — aapki aaj ki delivery mein ek ghalti hui thi jo hum ne correct kar di hai.\n\n✅ Corrected Details:\n🔵 Product: ${productName}\n🫙 Quantity: ${qty} bottles\n💰 Cash Collected: Rs. ${cashCollected}\n\nIs ghalti ke liye muafi chahte hain. Shukriya!`,
};
