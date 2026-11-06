"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, MailCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Alert, Button, Card, Field, inputClass } from "@/components/ui";

const loginSchema = z.object({
  email: z.string().trim().email("Informe um e-mail válido."),
  password: z.string().min(1, "Informe a senha."),
});
const signupSchema = z.object({
  fullName: z.string().trim().min(2, "Informe seu nome.").max(120),
  email: z.string().trim().email("Informe um e-mail válido."),
  password: z
    .string()
    .min(8, "Use pelo menos 8 caracteres.")
    .max(72, "Use no máximo 72 caracteres.")
    .regex(/[A-Za-z]/, "Inclua pelo menos uma letra.")
    .regex(/\d/, "Inclua pelo menos um número."),
});

type Values = { email: string; password: string; fullName?: string };

function translate(message: string) {
  const m = message.toLowerCase();
  if (m.includes("invalid login")) return "E-mail ou senha incorretos.";
  if (m.includes("email not confirmed")) return "Confirme seu e-mail antes de entrar (veja sua caixa de entrada).";
  if (m.includes("already registered")) return "Já existe uma conta com este e-mail.";
  if (m.includes("rate limit") || m.includes("too many")) return "Muitas tentativas. Aguarde alguns minutos.";
  if (m.includes("password")) return "Senha não aceita. Tente uma senha mais forte.";
  return "Não foi possível concluir. Tente novamente.";
}

export function AuthForm({ mode, next }: { mode: "login" | "signup"; next: string }) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(mode === "login" ? loginSchema : signupSchema) as never });

  async function onSubmit(values: Values) {
    setServerError(null);
    const supabase = createClient();
    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email: values.email, password: values.password });
      if (error) return setServerError(translate(error.message));
    } else {
      const { data, error } = await supabase.auth.signUp({
        email: values.email,
        password: values.password,
        options: {
          // apenas o nome vai nos metadados; o papel é definido pelo banco
          data: { full_name: values.fullName },
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
      if (error) return setServerError(translate(error.message));
      if (!data.session) return setCheckEmail(true);
    }
    router.replace(next);
    router.refresh();
  }

  if (checkEmail) {
    return (
      <Card className="p-6 text-center">
        <MailCheck className="mx-auto size-10 text-ok" aria-hidden />
        <h2 className="mt-3 font-semibold">Confirme seu e-mail</h2>
        <p className="mt-1 text-sm text-muted">
          Enviamos um link de confirmação. Depois de confirmar, você volta direto para continuar.
        </p>
      </Card>
    );
  }

  const other = mode === "login" ? "/cadastro" : "/login";
  return (
    <Card className="p-6">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {serverError && <Alert tone="bad">{serverError}</Alert>}
        {mode === "signup" && (
          <Field label="Nome" htmlFor="fullName" error={errors.fullName?.message}>
            <input id="fullName" autoComplete="name" className={inputClass} aria-invalid={!!errors.fullName} {...register("fullName")} />
          </Field>
        )}
        <Field label="E-mail" htmlFor="email" error={errors.email?.message}>
          <input id="email" type="email" autoComplete="email" inputMode="email" className={inputClass} aria-invalid={!!errors.email} {...register("email")} />
        </Field>
        <Field
          label="Senha"
          htmlFor="password"
          error={errors.password?.message}
          hint={mode === "signup" ? "Mínimo de 8 caracteres, com letras e números." : undefined}
        >
          <input
            id="password"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            className={inputClass}
            aria-invalid={!!errors.password}
            {...register("password")}
          />
        </Field>
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {mode === "login" ? "Entrar" : "Criar conta"}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-muted">
        {mode === "login" ? "Ainda não tem conta? " : "Já tem conta? "}
        <Link href={`${other}?next=${encodeURIComponent(next)}`} className="font-medium text-enamel hover:underline">
          {mode === "login" ? "Criar conta" : "Entrar"}
        </Link>
      </p>
    </Card>
  );
}
