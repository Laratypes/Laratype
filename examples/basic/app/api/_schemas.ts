import { z } from "zod";

/** A `User` model row, without the hidden password column. */
export const UserProfile = z.object({
  id: z.number(),
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  age: z.number(),
  isActive: z.boolean(),
});

/** An `Admin` model row, without the hidden password column. */
export const AdminProfile = z.object({
  id: z.number(),
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  age: z.number(),
});

export const LoginBody = z.object({
  email: z.string(),
  password: z.string(),
});

/** The 0.5 `CreateUserRequest` / `CreateAdminRequest` fields (the models ignore `name`). */
export const RegisterBody = z.object({
  email: z.string(),
  password: z.string().min(8),
  name: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  age: z.number().min(18),
});

export const LoginResponse = z.object({
  user: UserProfile,
  token: z.string(),
});

export const AdminLoginResponse = z.object({
  user: AdminProfile,
  token: z.string(),
});

export const CallbackResponse = z.object({ callback: z.boolean() });

export const GreetingResponse = z.object({ message: z.string() });

export const PostDto = z.object({
  id: z.number(),
  content: z.string(),
  created_at: z.date(),
  updated_at: z.date(),
});

export const PostList = z.object({ data: z.array(PostDto) });

export const PostStoreResponse = z.object({});

/** The schema's output: controllers return plain data, never the model instance (contract.md › Response from the contract). */
export const toUserProfile = (user: {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  age: number;
  isActive: boolean;
}) => ({
  id: user.id,
  email: user.email,
  firstName: user.firstName,
  lastName: user.lastName,
  age: user.age,
  isActive: user.isActive,
});

export const toAdminProfile = (admin: {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  age: number;
}) => ({
  id: admin.id,
  email: admin.email,
  firstName: admin.firstName,
  lastName: admin.lastName,
  age: admin.age,
});
