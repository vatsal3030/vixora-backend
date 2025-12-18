// import { PrismaClient } from "@prisma/client";

// const prismaClientSingleton = () => {
//   return new PrismaClient({
//     log:
//       process.env.NODE_ENV === "development"
//         ? ["error", "warn", "info"]
//         : ["error"],
//   });
// };

// const prisma = prismaClientSingleton();

// export default prisma;

// // Graceful shutdown
// if (process.env.NODE_ENV !== "production") {
//   global.prisma = prisma;
// }

// // Handle process termination
// process.on("SIGINT", async () => {
//   await prisma.$disconnect();
//   process.exit(0);
// });

// process.on("SIGTERM", async () => {
//   await prisma.$disconnect();
//   process.exit(0);
// });
