import { Router, type IRouter } from "express";
import healthRouter from "./health";
import departmentsRouter from "./departments";
import usersRouter from "./users";
import scriptsRouter from "./scripts";
import scriptFilesRouter from "./scriptFiles";
import executionsRouter from "./executions";
import auditRouter from "./audit";
import authRouter from "./auth";
import aiEnhanceRouter from "./aiEnhance";
import aiFixErrorRouter from "./aiFixError";
import settingsRouter from "./settings";
import foldersRouter from "./folders";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(departmentsRouter);
router.use(usersRouter);
router.use(scriptsRouter);
router.use(scriptFilesRouter);
router.use(executionsRouter);
router.use(aiEnhanceRouter);
router.use(aiFixErrorRouter);
router.use(auditRouter);
router.use(settingsRouter);
router.use(foldersRouter);

export default router;
