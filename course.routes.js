// course.routes.js
import { Router } from "express";
import {
  listCourses,
  searchCourses,
  getCourseDetail,
  getCourseSchedules,
  listSemesters,
} from "./course.controller.js";

const router = Router();

router.get("/", listCourses);
router.get("/search", searchCourses);
router.get("/semesters", listSemesters);   // 【新增】學期清單（一定要放在 "/:id" 前面，不然會被當成課程 id）
router.get("/:id", getCourseDetail);
router.get("/:id/schedules", getCourseSchedules);

export default router;
