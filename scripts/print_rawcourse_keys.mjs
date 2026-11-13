/**
 * 列出 rawCourse 物件的所有欄位名稱。
 * 用於欄位對映與除錯。
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const r = await prisma.rawCourse.findFirst();
  console.log("RawCourse keys =", Object.keys(r || {}));
}

main()
  .catch((e) => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });

  