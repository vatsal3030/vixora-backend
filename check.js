import 'dotenv/config';
import prisma from './src/db/prisma.js';

async function check() {
  try {
    const userCount = await prisma.user.count();
    console.log('Total users:', userCount);
  } catch (err) {
    console.error('Error connecting to DB:', err);
  } finally {
    await prisma.$disconnect();
  }
}
check();
