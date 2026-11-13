/**
 * 檢查 rawCourse 是否存在重複、衝突或時間重疊資料。
 * 用於資料清洗與偵錯分析。
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const list = await prisma.rawCourse.findMany({
  where: {
    dayOfWeek: 4,
    periods: { contains: '2' }
  },
  select: {
    id: true,
    dayOfWeek: true,
    periods: true
  },
  take: 10
});

console.log(list);

await prisma.$disconnect();
