import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const companyId = 'test-1';

  const company = await prisma.company.upsert({
    where: { id: companyId },
    update: {},
    create: {
      id: companyId,
      name: 'Test Company',
    },
  });

  const agent = await prisma.agent.upsert({
    where: { companyId },
    update: {},
    create: {
      id: `agent-${companyId}`,
      companyId,
      bot_instructions: `
Ви телефонуєте клієнту щоб запропонувати наші послуги.
Представтеся як менеджер компанії.
Запитайте, чи цікавить клієнта наша пропозиція.
Якщо клієнт зацікавлений - запропонуйте відправити комерційну пропозицію на email.
Якщо клієнт не зацікавлений - подякуйте за час і попрощайтеся.
Будьте ввічливими та професійними.
      `.trim(),
      calls_enabled: true,
    },
  });

  console.log('✅ Створено тестові дані:');
  console.log('Company:', company);
  console.log('Agent:', agent);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });


