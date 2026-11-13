export async function listSectionCards(req, res) {
  try {
    const userId = getUserId(req);
    const q = String(req.query.q || "").trim();
    const { page, pageSize, skip, take } = pickPaging(req);

    // 1) 先抓登入者已選的 sections（用來判斷 isSelected / isConflict）
    let selected = [];
    if (userId) {
      selected = await prisma.plannerItem.findMany({
        where: { userId },
        select: {
          sectionId: true,
          section: {
            select: {
              id: true,
              course: { select: { name: true } },
              schedules: { select: { day: true, start: true, end: true, location: true } }, // ✅
            },
          },
        },
      });
    }

    // 2) 查詢 sections（可選 q）
    const where = q
      ? {
          course: {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { teacher: { contains: q, mode: "insensitive" } },
            ],
          },
        }
      : undefined;

    const [total, rows] = await Promise.all([
      prisma.section.count({ where }),
      prisma.section.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        select: {
          id: true,
          code: true,
          quota: true,
          location: true, // ✅ section.location
          createdAt: true,

          course: {
            select: {
              id: true,
              code: true,
              name: true,
              teacher: true,
              credits: true,
              required: true,
              department: true,
              grade: true,
            },
          },

          schedules: { select: { day: true, start: true, end: true, location: true } }, // ✅ schedule.location
          _count: { select: { plannerItems: true } },
        },
      }),
    ]);

    // 3) 組成前端課程卡（CourseCard）
    const items = rows.map((sec, idx) => {
      const rawDept = sec.course.department;
      const cleanDept = String(rawDept ?? "").replace(/\s+/g, " ").trim();

      // 只 debug 第一筆就好（避免洗版）
      if (idx === 0) {
        console.log("RAW dept =", JSON.stringify(rawDept));
        console.log("CLEAN dept =", JSON.stringify(cleanDept));
      }

      const requiredText =
        sec.course.required === true ? "必修" :
        sec.course.required === false ? "選修" :
        "未知";

      const enrolled = sec._count.plannerItems;
      const remaining = sec.quota - enrolled;

      const isSelected = userId
        ? selected.some((x) => x.sectionId === sec.id)
        : false;

      let isConflict = false;
      const conflictWithSet = new Set();

      if (userId && !isSelected) {
        for (const picked of selected) {
          const pickedName = picked.section?.course?.name || "(unknown)";
          const pickedSchedules = picked.section?.schedules || [];

          for (const s1 of sec.schedules) {
            for (const s2 of pickedSchedules) {
              if (isTimeConflict(s1, s2)) {
                isConflict = true;
                conflictWithSet.add(pickedName);
              }
            }
          }
        }
      }

      const conflictWith = Array.from(conflictWithSet);

      return {
        courseId: sec.course.id,
        sectionId: sec.id,
        courseCode: sec.course.code ?? null,
        sectionCode: sec.code,

        name: sec.course.name,
        credits: sec.course.credits,
        teacher: sec.course.teacher,

        required: sec.course.required ?? null,
        requiredText,

        department: cleanDept || null,
        departmentText: cleanDept || "未知",

        grade: sec.course.grade ?? null,

        // ✅ 關鍵：把 schedules 原樣回傳（內含 location）
        schedules: sec.schedules,

        // ✅ section 的摘要地點（你也可以前端用它做 fallback）
        location: sec.location ?? null,

        quota: sec.quota,
        enrolled,
        remaining,

        isSelected,
        isConflict,
        conflictWith,
        canAdd: !isSelected && !isConflict && remaining > 0,
      };
    });

    return res.json({
      ok: true,
      q,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      items,
    });
  } catch (err) {
    console.error("[SECTION-CARDS] ERROR =", err);
    return res.status(500).json({
      ok: false,
      error: "INTERNAL_ERROR",
      message: String(err?.message || err),
    });
  }
}
