import { Link } from "wouter";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { useLanguage } from "@/contexts/LanguageContext";

export default function NotFound() {
  const { t } = useLanguage();

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-background text-foreground">
      <div className="absolute right-6 top-6">
        <LanguageSwitcher />
      </div>
      <h1 className="mb-4 text-4xl font-bold">{t("notFoundTitle")}</h1>
      <p className="mb-4">{t("notFoundDescription")}</p>
      <Link href="/" className="text-primary hover:underline">
        {t("goHome")}
      </Link>
    </div>
  );
}
