import { COOKIE_NAME, __prod__ } from "./constants";
import express from "express";
import { ApolloServer } from "apollo-server-express";
import { buildSchema } from "type-graphql";
import { HelloResolver } from "./resolvers/hello";
import { PostResolver } from "./resolvers/post";
import { UserResolver } from "./resolvers/user";
import Redis from "ioredis";
import session from "express-session";
import connectRedis from "connect-redis";
import { MyContext } from "./types";
import cors from "cors";
import path from "path";
import { createConnection } from "typeorm";
import { User } from "./entities/User";
import { Post } from "./entities/Post";
import "reflect-metadata";
import { Updoot } from "./entities/Updoot";
import { createUserLoader } from "./utils/createUserLoader";
import { createUpdootLoader } from "./utils/createUpdootLoader";
const main = async () => {
  const conn = await createConnection({
    type: "postgres",
    database: "lireddit2",
    username: "postgres",
    password: "admin",
    logging: true,
    synchronize: true,
    migrations: [path.join(__dirname, "./migrations/*")],
    entities: [Post, User, Updoot],
  });
  await conn.runMigrations();

  //conn.migrations
  //const orm = await MikroORM.init(microConfig);
  //Migration auto
  //orm.getMigrator().up();
  const app = express();
  //app.use(cors)
  const RedisStore = connectRedis(session);
  const redis = new Redis();

  app.use(
    "/",
    cors({
      origin: "http://localhost:3000",
      credentials: true,
    }),
    session({
      name: COOKIE_NAME,
      store: new RedisStore({ client: redis, disableTouch: true }),
      secret: "keyboard cat", //anything
      resave: false,
      saveUninitialized: false,
      cookie: {
        maxAge: 1000 * 60 * 60 * 24 * 365 * 10, //10 years
        httpOnly: true,
        sameSite: "lax", //csrf
        secure: __prod__, //only https on prod
      },
    })
  );
  const appoloServer = new ApolloServer({
    schema: await buildSchema({
      resolvers: [HelloResolver, PostResolver, UserResolver],
      validate: false,
    }),
    context: ({ req, res }): MyContext => ({
      req,
      res,
      redis,
      userLoader: createUserLoader(),
      updootLoader:createUpdootLoader()
    }),
  });

  appoloServer.applyMiddleware({
    app,
    cors: { origin: "http://localhost:3000" },
  });

  const port = 4000;
  app.listen(port, () => {
    console.log("server started on localhost:", port);
  });
};
main().catch((err) => {
  console.error(err);
});
