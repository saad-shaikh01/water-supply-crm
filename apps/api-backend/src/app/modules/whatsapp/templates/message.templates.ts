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
    `Assalam o Alaikum ${customerName},\n\nYe aapka outstanding balance reminder hai:\n💰 Due Amount: Rs. ${balance.toFixed(2)}\n\nKripya jald payment karein. Shukriya!`,

  deliveryScheduled: (customerName: string, date: string) =>
    `Assalam o Alaikum ${customerName}! 📅\n\nAapki delivery schedule hui hai:\n📆 Date: ${date}\n\nDriver aapke ghar aayega. Shukriya!`,

  orderApproved: (customerName: string, productName: string, qty: number) =>
    `Assalam o Alaikum ${customerName}! ✅\n\nAapka order approve ho gaya:\n🔵 Product: ${productName}\n🫙 Quantity: ${qty}\n\nHum jald delivery karenge. Shukriya!`,

  orderRejected: (customerName: string, productName: string, reason?: string) =>
    `Assalam o Alaikum ${customerName},\n\nAfsos! Aapka order reject ho gaya:\n🔵 Product: ${productName}${reason ? `\n❌ Reason: ${reason}` : ''}\n\nKoi sawaal ho toh support se rabta karein.`,

  ticketReplied: (customerName: string, subject: string) =>
    `Assalam o Alaikum ${customerName}! 💬\n\nAapke ticket ka jawab aa gaya:\n📋 Subject: ${subject}\n\nPortal mein check karein. Shukriya!`,
};
