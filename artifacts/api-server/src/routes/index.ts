import { Router, type IRouter } from "express";
import healthRouter from "./health";
import departmentsRouter from "./departments";
import usersRouter from "./users";
import scriptsRouter from "./scripts";
import executionsRouter from "./executions";
import auditRouter from "./audit";
import authRouter from "./auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(departmentsRouter);
router.use(usersRouter);
router.use(scriptsRouter);
router.use(executionsRouter);
router.use(auditRouter);

export default router;
