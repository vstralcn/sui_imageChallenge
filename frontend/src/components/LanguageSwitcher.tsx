import { Globe } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";

type Props = {
  className?: string;
};

export default function LanguageSwitcher({ className }: Props) {
  const { language, setLanguage, t } = useLanguage();

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Globe className="h-4 w-4 text-primary" aria-hidden="true" />
      <select
        aria-label={t("languageSelectorAria")}
        value={language}
        onChange={(event) => setLanguage(event.target.value === "zh" ? "zh" : "en")}
        className="h-9 rounded-md border border-primary/50 bg-card px-2 text-sm text-foreground outline-none ring-offset-background transition-colors focus-visible:ring-2 focus-visible:ring-ring"
      >
        <option value="en">{t("languageEnglish")}</option>
        <option value="zh">{t("languageChinese")}</option>
      </select>
    </div>
  );
}
