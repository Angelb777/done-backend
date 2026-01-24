const { z } = require("zod");
const { TASK_COLORS, MESSAGE_TYPES, TASK_STATUS } = require("./constants");

const emailSchema = z.string().email().max(200);
const passwordSchema = z.string().min(6).max(200);

const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().min(1).max(80),
});

const loginSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

const createChatSchema = z.object({
  type: z.enum(["DM", "GROUP"]),
  title: z.string().max(120).optional(),
  memberIds: z.array(z.string().min(1)).min(1),
  photoUrl: z.string().url().optional(),
});

/**
 * ✅ Mensajes
 * - NORMAL: text opcional (aunque normalmente lo mandas)
 * - TASK: requiere task (y title dentro)
 * - FILE/IMAGE: para cuando uses /messages/upload, este schema no se usa (multipart),
 *   pero dejamos el enum preparado si luego quieres unificar.
 */
const sendMessageSchema = z
  .object({
    chatId: z.string().min(1),

    // ✅ default para evitar "type required" si algún cliente falla
    type: z
      .enum([
        MESSAGE_TYPES.NORMAL,
        MESSAGE_TYPES.TASK,
        // ✅ preparados para el futuro (no rompe)
        MESSAGE_TYPES.FILE ?? "FILE",
        MESSAGE_TYPES.IMAGE ?? "IMAGE",
      ])
      .default(MESSAGE_TYPES.NORMAL),

    text: z.string().max(4000).optional(),
    imageUrl: z.string().url().optional(),

    // Scheduling
    scheduledFor: z.string().datetime().optional(),

    // TASK payload
    task: z
      .object({
        title: z.string().min(1).max(200),
        color: z.enum(TASK_COLORS).default("gray"),
        assigneeId: z.string().min(1).optional(),
        dueDate: z.string().datetime().optional(),
        status: z.enum([TASK_STATUS.PENDING, TASK_STATUS.DONE]).optional(),
      })
      .optional(),
  })
  .superRefine((val, ctx) => {
    // ✅ si es TASK, task es obligatorio
    if (val.type === MESSAGE_TYPES.TASK && !val.task) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "task payload required for TASK messages",
        path: ["task"],
      });
    }

    // ✅ si viene task, sincronizamos text (tu backend usa text como preview)
    // No lo hacemos obligatorio, pero ayuda a que siempre haya título en msg.text
    if (val.type === MESSAGE_TYPES.TASK && val.task?.title && (!val.text || !val.text.trim())) {
      // no mutamos aquí (zod), solo validamos; el backend puede setearlo.
    }
  });

const updateTaskStatusSchema = z.object({
  taskId: z.string().min(1),
  status: z.enum([TASK_STATUS.PENDING, TASK_STATUS.DONE]),
  completionNote: z.string().max(500).optional(),
  completionImageUrl: z.string().url().optional(),
});

module.exports = {
  registerSchema,
  loginSchema,
  createChatSchema,
  sendMessageSchema,
  updateTaskStatusSchema,
};
