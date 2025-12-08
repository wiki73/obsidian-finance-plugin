const { Plugin, Notice, Modal, TFile } = require("obsidian");

class AddTransactionModal extends Modal {
  constructor(app, plugin, type) {
    super(app);
    this.plugin = plugin;
    this.type = type; // "expense" или "income"
  }

  onOpen() {
    const { contentEl } = this;

    contentEl.createEl("h2", { text: this.type === "expense" ? "Добавить расход" : "Добавить доход" });

    const form = contentEl.createEl("div", { cls: "finance-form" });
    form.style.display = "flex";
    form.style.flexDirection = "column";
    form.style.gap = "8px";
    form.style.marginTop = "8px";

    // Сумма
    const amountLabel = form.createEl("label", { text: "Сумма" });
    const amount = form.createEl("input", { type: "number", placeholder: "Например: 500" });

    // Категория
    const catLabel = form.createEl("label", { text: "Категория" });
    const category = form.createEl("input", { type: "text", placeholder: "Например: Еда" });

    // Дата
    const dateLabel = form.createEl("label", { text: "Дата" });
    const dateInput = form.createEl("input", { type: "date" });
    dateInput.value = new Date().toISOString().split("T")[0];

    // Комментарий
    const commentLabel = form.createEl("label", { text: "Комментарий (необязательно)" });
    const comment = form.createEl("input", { type: "text", placeholder: "Например: Шаурма" });

    // Кнопка сохранить
    const btn = form.createEl("button", { text: "Сохранить" });
    btn.addEventListener("click", async () => {
      if (!amount.value || !category.value || !dateInput.value) {
        new Notice("Введите сумму, категорию и дату!");
        return;
      }
      await this.plugin.saveTransaction(
        amount.value,
        category.value,
        dateInput.value,
        comment.value,
        this.type
      );
      new Notice(`${this.type === "expense" ? "Расход" : "Доход"} сохранен!`);
      this.close();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

module.exports = class FinancePlugin extends Plugin {
  async onload() {
    // Команда добавления расхода
    this.addCommand({
      id: "add-expense",
      name: "Добавить расход",
      callback: () => {
        new AddTransactionModal(this.app, this, "expense").open();
      }
    });

    // Команда добавления дохода
    this.addCommand({
      id: "add-income",
      name: "Добавить доход",
      callback: () => {
        new AddTransactionModal(this.app, this, "income").open();
      }
    });
  }

  async saveTransaction(amount, category, date, comment, type) {
    const d = new Date(date);
    const monthFileName = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,"0")}.md`;
    const monthsFolder = "Finance/Months";
    const chartsFolder = "Finance/Charts";

    // Создание папок если нет
    if (!this.app.vault.getAbstractFileByPath("Finance")) await this.app.vault.createFolder("Finance");
    if (!this.app.vault.getAbstractFileByPath(monthsFolder)) await this.app.vault.createFolder(monthsFolder);
    if (!this.app.vault.getAbstractFileByPath(chartsFolder)) await this.app.vault.createFolder(chartsFolder);

    const filePath = `${monthsFolder}/${monthFileName}`;
    let file = this.app.vault.getAbstractFileByPath(filePath);

    // Создаём шаблон месяца, если файла нет
    if (!file) {
      const template = `# 📊 Финансы — ${monthFileName}

## 📥 Доходы
# Формат: +Сумма | Категория | Дата | Комментарий

## 📤 Расходы
# Формат: -Сумма | Категория | Дата | Комментарий
`;
      await this.app.vault.create(filePath, template);
      file = this.app.vault.getAbstractFileByPath(filePath);
    }

    // Читаем контент
    let content = await this.app.vault.read(file);
    const sign = type === "expense" ? "-" : "+";
    const sectionHeader = type === "expense" ? "## 📤 Расходы" : "## 📥 Доходы";
    const lines = content.split("\n");

    // Находим индекс раздела
    let insertIndex = lines.findIndex(l => l.trim() === sectionHeader);
    insertIndex += 1;

    // Считаем существующие элементы для нумерации
    let count = 0;
    while (insertIndex + count < lines.length && /^\d+\./.test(lines[insertIndex + count])) {
      count++;
    }

    // Формируем нумерованную строку
    const numberedLine = `${count + 1}. ${sign}${amount} ₽ | ${category} | ${date}${comment ? ` | ${comment}` : ""}`;
    lines.splice(insertIndex + count, 0, numberedLine);

    // Перезаписываем файл месяца
    await this.app.vault.modify(file, lines.join("\n"));

    // Обновляем диаграммы
    await this.updateCharts(filePath, monthFileName, chartsFolder);
  }

  async updateCharts(monthFilePath, monthFileName, chartsFolder) {
    const file = this.app.vault.getAbstractFileByPath(monthFilePath);
    if (!file) return;

    const content = await this.app.vault.read(file);
    const lines = content.split("\n");

    const incomeLines = [];
    const expenseLines = [];
    let section = null;

    for (let line of lines) {
        if (line.startsWith("## 📥")) section = "income";
        else if (line.startsWith("## 📤")) section = "expense";
        else if (line.startsWith("#") || line.trim() === "") continue;

        else if (section === "income") incomeLines.push(line);
        else if (section === "expense") expenseLines.push(line);
    }

    const expenseByCat = {};
    for (let l of expenseLines) {
        const parts = l.split("|").map(p => p.trim());
        if (parts.length >= 2) {
            const value = parseFloat(parts[0].replace(/^\d+\./, "").replace(/[^0-9.]/g, ""));
            const cat = parts[1];
            expenseByCat[cat] = (expenseByCat[cat] || 0) + value;
        }
    }

    const incomeByCat = {};
    for (let l of incomeLines) {
        const parts = l.split("|").map(p => p.trim());
        if (parts.length >= 2) {
            const value = parseFloat(parts[0].replace(/^\d+\./, "").replace(/[^0-9.]/g, ""));
            const cat = parts[1];
            incomeByCat[cat] = (incomeByCat[cat] || 0) + value;
        }
    }

    const getRandomColor = () => {
        const letters = "0123456789ABCDEF";
        let color = "#";
        for (let i = 0; i < 6; i++) color += letters[Math.floor(Math.random() * 16)];
        return color;
    };

    const totalIncome = Object.values(incomeByCat).reduce((a,b) => a+b, 0);
    const totalExpense = Object.values(expenseByCat).reduce((a,b) => a+b, 0);

    const expenseColors = Object.keys(expenseByCat).map(() => `"${getRandomColor()}"`);
    const incomeColors = Object.keys(incomeByCat).map(() => `"${getRandomColor()}"`);
    const compareColors = [`"green"`, `"red"`];

    const charts = [
        {
            name: `${monthFileName}-expenses-by-category.md`,
            labels: Object.keys(expenseByCat),
            series: [{ title: "Расходы", data: Object.values(expenseByCat) }],
            colors: expenseColors,
            type: "pie",
            title: "Расходы по категориям"
        },
        {
            name: `${monthFileName}-income-by-category.md`,
            labels: Object.keys(incomeByCat),
            series: [{ title: "Доходы", data: Object.values(incomeByCat) }],
            colors: incomeColors,
            type: "pie",
            title: "Доходы по категориям"
        },
        {
            name: `${monthFileName}-income-vs-expense.md`,
            labels: ["Доходы", "Расходы"],
            series: [{ title: "Сравнение", data: [totalIncome, totalExpense] }],
            colors: compareColors,
            type: "bar",
            title: "Доходы vs Расходы"
        }
    ];

    // Создание диаграмм
    for (let c of charts) {
        const chartPath = `${chartsFolder}/${c.name}`;
        const chartContent = `\`\`\`chart
type: ${c.type}
labels: [${c.labels.join(",")}]
series:
${c.series.map((s) => `  - title: ${s.title}\n    data: [${s.data.join(",")}]\n    backgroundColor: [${c.colors.join(",")}]`).join("\n")}
options:
  plugins:
    datalabels:
      display: true
      color: black
      font:
        weight: bold
width: 60%
height: 400px
\`\`\``;

        const chartFile = this.app.vault.getAbstractFileByPath(chartPath);
        if (chartFile) await this.app.vault.modify(chartFile, chartContent);
        else await this.app.vault.create(chartPath, chartContent);
    }

    // Создание статистики в той же папке charts
    const topExpenses = Object.entries(expenseByCat)
        .sort((a,b) => b[1]-a[1])
        .slice(0,5)
        .map(([cat, val], idx) => `${idx+1}. ${cat}: ${val} ₽`)
        .join("\n");

    const topIncome = Object.entries(incomeByCat)
        .sort((a,b) => b[1]-a[1])
        .slice(0,5)
        .map(([cat, val], idx) => `${idx+1}. ${cat}: ${val} ₽`)
        .join("\n");

    const statsContent = `# Статистика за месяц ${monthFileName}

## Общие показатели
- Общие доходы: ${totalIncome} ₽
- Общие расходы: ${totalExpense} ₽
- Сальдо: ${totalIncome - totalExpense} ₽

## Наибольшие доходы
${topIncome}

## Наибольшие расходы
${topExpenses}
`;

    const statsPath = `${chartsFolder}/${monthFileName}-stats.md`;
    const statsFile = this.app.vault.getAbstractFileByPath(statsPath);
    if (statsFile) await this.app.vault.modify(statsFile, statsContent);
    else await this.app.vault.create(statsPath, statsContent);
  }
};
