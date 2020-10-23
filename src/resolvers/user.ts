import { MyContext } from "../types";
import argon2 from "argon2";
import {
  Arg,
  Ctx,
  Field,
  FieldResolver,
  Int,
  Mutation,
  ObjectType,
  Query,
  Resolver,
  Root,
} from "type-graphql";
import { User } from "../entities/User";
import { COOKIE_NAME, FORGOT_PASSWORD_PREFIX } from "../constants";
import { UsernamePasswordInput } from "../utils/UsernamePasswordInput";
import { validateRegister } from "../utils/validateRegister";
import { sendEmail } from "../utils/sendEmail";
import { v4 } from "uuid";
import { getConnection } from "typeorm";

@ObjectType()
class FieldError {
  @Field()
  field: string;
  @Field()
  message: string;
}

@ObjectType()
class UserResponse {
  @Field(() => [FieldError, { nullable: true }])
  errors?: FieldError[];
  @Field(() => User, { nullable: true })
  user?: User;
}

@Resolver(User)
export class UserResolver {
  @FieldResolver(() => String)
  email(@Root() user: User, @Ctx() { req }: MyContext) {
    //you are  post owner

    if (req.session?.userId === user.id) {
      return user.email;
    }
    //you are not post owner
    return "";
  }

  @Mutation(() => UserResponse, { nullable: true })
  async changePassword(
    @Arg("token") token: string,
    @Arg("newPassword") newPassword: string,
    @Ctx() { redis, req }: MyContext
  ): Promise<UserResponse> {
    if (newPassword.length <= 2) {
      return {
        errors: [
          {
            field: "newPassword",
            message: "lenght must be greater than 2",
          },
        ],
      };
    }
    const key = FORGOT_PASSWORD_PREFIX + token;
    const userId = await redis.get(key);
    if (!userId) {
      return {
        errors: [
          {
            field: "token",
            message: "token expired",
          },
        ],
      };
    }
    const userIdNum = parseInt(userId);
    const user = await User.findOne(userIdNum);
    if (!user) {
      return {
        errors: [
          {
            field: "token",
            message: "user no longer exists",
          },
        ],
      };
    }

    //user.password = await argon2.hash(newPassword);
    await User.update(
      { id: userIdNum },
      {
        password: await argon2.hash(newPassword),
      }
    );
    await redis.del(key);

    //log in user after change password
    req.session!.userId = user.id;

    return {
      user,
      errors: [],
    };
  }
  @Mutation(() => Boolean)
  async forgotPassword(
    @Arg("email") email: string,
    @Ctx() { redis }: MyContext
  ) {
    const user = await User.findOne({ where: { email } });

    const token = v4();
    const key = FORGOT_PASSWORD_PREFIX + token;

    if (user) {
      await redis.set(key, user.id, "ex", 1000 * 60 * 60 * 24);
      sendEmail(
        email,
        `<a href="http://localhost:3000/change-password/${token}">reset password</a>`
      );
      return true;
    }

    return true;
  }
  @Query(() => User, { nullable: true })
  async me(@Ctx() { req }: MyContext) {
    console.log("session", req.session);

    //You are not logger
    if (!req.session?.userId) {
      return null;
    }
    const user = await User.findOne({ id: req.session.userId });
    return user;
  }

  @Mutation(() => UserResponse)
  async register(
    @Arg("options") options: UsernamePasswordInput,
    @Ctx() { req }: MyContext
  ): Promise<UserResponse> {
    const errors = validateRegister(options);
    if (errors) {
      console.log("errors");
      return { errors };
    }

    const hashedPassword = await argon2.hash(options.password);
    let user = 5 as any;

    try {
      const result = await getConnection()
        .createQueryBuilder()
        .insert()
        .into(User)
        .values({
          username: options.username,
          password: hashedPassword,
          email: options.email,
        })
        .returning("*")
        .execute();
      user = result.generatedMaps[0];
      console.log("****************************************");
      console.log(result);
    } catch (err) {
      console.log("err", err);
      if (err.code === "23505") {
        //duplicate username error
        return {
          // user:undefined,
          errors: [
            { field: "usernameOrEmail", message: "usename already taken" },
          ],
        };
      }
    }

    //store user id session
    //this will set a cookie on the user
    //keep them logged in
    req.session!.userId = user.id;
    return { user, errors: [] };
  }

  @Mutation(() => UserResponse)
  async login(
    @Arg("usernameOrEmail") usernameOrEmail: string,
    @Arg("password") password: string,
    @Ctx() { req }: MyContext
  ): Promise<UserResponse> {
    const user = await User.findOne(
      usernameOrEmail.includes("@")
        ? { where: { email: usernameOrEmail } }
        : { where: { username: usernameOrEmail } }
    );
    if (!user) {
      return {
        errors: [
          { field: "usernameOrEmail", message: "that username dosen't exist" },
        ],
      };
    }
    const valid = await argon2.verify(user.password, password);
    if (!valid) {
      return {
        errors: [{ field: "password", message: "incorrect password" }],
      };
    }
    req.session!.userId = user.id;
    //req.session!.randomKey = "jinen is cool";
    console.log("i am user");

    return {
      user,
      errors: [],
    };
  }
  @Mutation(() => Boolean)
  logout(@Ctx() { req, res }: MyContext) {
    return new Promise((resolve) =>
      req.session?.destroy((err) => {
        res.clearCookie(COOKIE_NAME);
        if (err) {
          console.log(err);
          resolve(false);
        }
        resolve(true);
      })
    );
  }
}
