// «Отправка» писем. Настоящего почтового сервера в лабе нет,
// поэтому письмо просто печатается в терминал, где запущен сервер.
export const sendMail = (to: string, subject: string, text: string): void => {
    console.log('\n========== ПИСЬМО (имитация отправки) ==========');
    console.log(`Кому:  ${to}`);
    console.log(`Тема:  ${subject}`);
    console.log(`Текст: ${text}`);
    console.log('================================================\n');
};
