const { Plugin, Notice, Modal, TFolder } = require("obsidian");

/* ================= CONFIG ================= */

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const COLOR_PALETTE = [
  "#4CAF50",
  "#2196F3",
  "#FFC107",
  "#F44336",
  "#9C27B0",
  "#FF9800",
  "#00BCD4",
  "#8BC34A",
  "#3F51B5",
  "#E91E63",
  "#CDDC39",
  "#795548",
];

function formatMoney(n) {
  return Number(n).toFixed(2);
}

function getMonthInfo(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const monthIndex = d.getMonth();
  const monthName = MONTH_NAMES[monthIndex];
  const monthNum = String(monthIndex + 1).padStart(2, "0");
  return { year, monthFolder: `${monthNum}-${monthName}` };
}

/* ================= MODAL ================= */

class AddTransactionModal extends Modal {
  constructor(app, plugin, type) {
    super(app);
    this.plugin = plugin;
    this.type = type;
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", {
      text: this.type === "expense" ? "Добавить расход" : "Добавить доход",
    });

    const form = contentEl.createDiv();
    form.style.display = "flex";
    form.style.flexDirection = "column";
    form.style.gap = "12px";

    const amount = form.createEl("input", {
      type: "number",
      placeholder: "Сумма",
    });

    const preview = form.createEl("div", { text: "0.00 ₽" });
    amount.addEventListener("input", () => {
      preview.textContent = formatMoney(amount.value || 0) + " ₽";
    });

    const categories = await this.plugin.getAllCategories();
    const select = form.createEl("select");
    select.createEl("option", { text: "Выберите категорию", value: "" });
    categories.forEach((c) => {
      select.createEl("option", { text: c, value: c });
    });
    select.createEl("option", {
      text: "+ Новая категория...",
      value: "__new__",
    });

    const newCat = form.createEl("input", {
      type: "text",
      placeholder: "Название новой категории",
    });
    newCat.style.display = "none";

    select.addEventListener("change", () => {
      newCat.style.display = select.value === "__new__" ? "block" : "none";
    });

    const dateInput = form.createEl("input", { type: "date" });
    dateInput.value = new Date().toISOString().split("T")[0];

    const comment = form.createEl("input", {
      type: "text",
      placeholder: "Комментарий",
    });

    const btn = form.createEl("button", { text: "Сохранить", cls: "mod-cta" });

    btn.onclick = async () => {
      if (!amount.value) return new Notice("Введите сумму");
      const category = select.value === "__new__" ? newCat.value : select.value;
      if (!category) return new Notice("Выберите категорию");

      await this.plugin.saveTransaction({
        amount: formatMoney(amount.value),
        category: category.trim(),
        date: dateInput.value,
        comment: comment.value.trim(),
        type: this.type,
      });

      new Notice("Сохранено");
      this.close();
    };
  }
}

/* ================= PLUGIN ================= */

module.exports = class FinancePlugin extends Plugin {
  async onload() {
    this.addCommand({
      id: "add-expense",
      name: "Добавить расход",
      callback: () => new AddTransactionModal(this.app, this, "expense").open(),
    });

    this.addCommand({
      id: "add-income",
      name: "Добавить доход",
      callback: () => new AddTransactionModal(this.app, this, "income").open(),
    });
  }

  async ensureFolder(path) {
    if (!this.app.vault.getAbstractFileByPath(path)) {
      await this.app.vault.createFolder(path);
    }
  }

  async writeFile(path, content) {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing) await this.app.vault.modify(existing, content);
    else await this.app.vault.create(path, content);
  }

  async getAllCategories() {
    const categories = new Set();
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.includes("Finance") && f.name === "data.md");
    for (const file of files) {
      const content = await this.app.vault.read(file);
      content.split("\n").forEach((line) => {
        if (line.includes("|")) {
          const parts = line.split("|");
          if (parts.length >= 2 && !parts[1].includes("Категория")) {
            categories.add(parts[1].trim());
          }
        }
      });
    }
    return Array.from(categories);
  }

  async saveTransaction(data) {
    const base = "Finance";
    const { year, monthFolder } = getMonthInfo(data.date);

    const yearPath = `${base}/${year}`;
    const monthPath = `${yearPath}/${monthFolder}`;
    const yearsPath = `${base}/Years`;

    await this.ensureFolder(base);
    await this.ensureFolder(yearPath);
    await this.ensureFolder(monthPath);
    await this.ensureFolder(yearsPath);

    const dataFile = `${monthPath}/data.md`;
    let file = this.app.vault.getAbstractFileByPath(dataFile);
    if (!file) {
      await this.app.vault.create(
        dataFile,
        "### Transactions\n| Сумма | Категория | Дата | Комментарий |\n| --- | --- | --- | --- |",
      );
      file = this.app.vault.getAbstractFileByPath(dataFile);
    }

    const sign = data.type === "expense" ? "-" : "+";
    const line = `${sign}${data.amount} ₽ | ${data.category} | ${data.date} | ${data.comment || ""}`;

    const content = await this.app.vault.read(file);
    await this.app.vault.modify(file, content + "\n" + line);

    await this.updateMonth(monthPath);
    await this.updateYear(year);
    await this.updateDashboard();
  }

  async parseMonth(path) {
    const file = this.app.vault.getAbstractFileByPath(`${path}/data.md`);
    if (!file) return [];

    const content = await this.app.vault.read(file);
    return content
      .split("\n")
      .filter((l) => l.startsWith("+") || l.startsWith("-"))
      .map((l) => {
        const parts = l.split("|").map((p) => p.trim());
        // Извлекаем число, учитывая минус
        const rawAmount = parts[0].replace(/[^-0-9.]/g, "");
        return {
          amount: parseFloat(rawAmount),
          type: l.startsWith("-") ? "expense" : "income",
          category: parts[1],
          date: parts[2],
        };
      });
  }

  async createChart(path, title, dataObj) {
    const labels = Object.keys(dataObj);
    const values = Object.values(dataObj);
    if (labels.length === 0) return;

    const colors = labels.map(
      (_, i) => COLOR_PALETTE[i % COLOR_PALETTE.length],
    );

    // Важно: здесь используется блок ```chart
    const content = `\`\`\`chart
type: bar
labels: [${labels.map((l) => `"${l}"`).join(", ")}]
series:
  - title: "${title}"
    data: [${values.join(", ")}]
    backgroundColor: [${colors.map((c) => `"${c}"`).join(", ")}]
\`\`\``;

    await this.writeFile(path, content);
  }

  async updateMonth(path) {
    const data = await this.parseMonth(path);
    const expenseByCat = {},
      incomeByCat = {};

    data.forEach((t) => {
      const target = t.type === "expense" ? expenseByCat : incomeByCat;
      target[t.category] = (target[t.category] || 0) + Math.abs(t.amount);
    });

    const totalIncome = Object.values(incomeByCat).reduce((a, b) => a + b, 0);
    const totalExpense = Object.values(expenseByCat).reduce((a, b) => a + b, 0);

    await this.createChart(
      `${path}/expenses_chart.md`,
      "Расходы",
      expenseByCat,
    );
    await this.createChart(`${path}/income_chart.md`, "Доходы", incomeByCat);
    await this.createChart(`${path}/summary_chart.md`, "Итог", {
      Доход: totalIncome,
      Расход: totalExpense,
    });
  }

  async updateYear(year) {
    const yearFolder = this.app.vault.getAbstractFileByPath(`Finance/${year}`);
    if (!(yearFolder instanceof TFolder)) return;

    const monthlyBalances = {};
    const months = yearFolder.children
      .filter((f) => f instanceof TFolder)
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const m of months) {
      const data = await this.parseMonth(m.path);
      const balance = data.reduce((a, b) => a + b.amount, 0);
      monthlyBalances[m.name] = balance;
    }

    await this.createChart(
      `Finance/Years/${year}-summary.md`,
      `Баланс по месяцам (${year})`,
      monthlyBalances,
    );
  }

  async updateDashboard() {
    const now = new Date();
    const { year, monthFolder } = getMonthInfo(now);
    const path = `Finance/${year}/${monthFolder}`;
    const data = await this.parseMonth(path);

    const totalIncome = data
      .filter((t) => t.type === "income")
      .reduce((a, b) => a + b.amount, 0);
    const totalExpense = Math.abs(
      data
        .filter((t) => t.type === "expense")
        .reduce((a, b) => a + b.amount, 0),
    );
    const balance = totalIncome - totalExpense;

    const content =
      `# 💰 Финансы: Дашборд\n` +
      `**Период:** ${monthFolder} ${year}\n\n` +
      `| Доходы | Расходы | Баланс |\n` +
      `| --- | --- | --- |\n` +
      `| ${formatMoney(totalIncome)} ₽ | ${formatMoney(totalExpense)} ₽ | **${formatMoney(balance)} ₽** |\n\n` +
      `### График расходов по категориям\n` +
      `![[${path}/expenses_chart.md]]\n\n` +
      `### Сравнение за месяц\n` +
      `![[${path}/summary_chart.md]]\n\n` +
      `--- \n` +
      `_Обновлено: ${new Date().toLocaleString()}_`;

    await this.writeFile("Finance/Dashboard.md", content);
  }
};
