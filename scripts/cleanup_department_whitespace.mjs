/**
 * 清理 department 欄位的前後空白與異常字元。
 * 避免部門篩選（startsWith）時因空白導致比對失敗。
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.course.findMany({
    where: { department: { not: null } },
    select: { id: true, department: true },
  });

  let updated = 0;

  for (const r of rows) {
    const cleaned = String(r.department).replace(/\s+/g, " ").trim();
    if (cleaned !== r.department) {
      await prisma.course.update({
        where: { id: r.id },
        data: { department: cleaned },
      });
      updated++;
    }
  }

  console.log("✅ cleaned departments:", updated);
}

main()
  .catch((e) => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
