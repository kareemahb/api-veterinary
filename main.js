const DOG_API = "https://dogapi.dog/api/v2";
const WIKI_API = "https://en.wikipedia.org/w/api.php";

// Safety limit so a bad response can't cause endless page requests
const MAX_PAGES = 60;

const KG_TO_LB = 2.20462;

class VetBreedApp {
  constructor() {
    this.breeds = [];
    this.groups = new Map();
    this.wikiRequestId = 0;

    this.form = document.querySelector("#breedForm");
    this.breedSelect = document.querySelector("#breedSelect");
    this.breedFilter = document.querySelector("#breedFilter");
    this.randomButton = document.querySelector("#randomButton");
    this.result = document.querySelector("#breedResult");
    this.status = document.querySelector("#status");

    this.form.addEventListener("submit", (event) => {
      this.handleSubmit(event);
    });

    this.breedFilter.addEventListener("input", () => {
      this.populateBreedSelect(this.breedFilter.value);
    });

    this.randomButton.addEventListener("click", () => {
      this.showRandomBreed();
    });

    this.loadBreeds();
    this.loadDogFact();
  }

  setStatus(message, isError = false) {
    this.status.textContent = message;
    this.status.classList.toggle("is-error", isError);
  }

  // The Dog API sends breeds a page at a time, so this follows every page
  async fetchAllPages(endpoint) {
    const getPage = async (pageNumber) => {
      const response = await fetch(
        `${DOG_API}/${endpoint}?page[number]=${pageNumber}`,
      );

      if (!response.ok) {
        throw new Error(`Could not load ${endpoint} (page ${pageNumber}).`);
      }

      return response.json();
    };

    const firstPage = await getPage(1);
    const lastPage = Math.min(firstPage.meta?.pagination?.last ?? 1, MAX_PAGES);

    const pageNumbers = Array.from(
      { length: lastPage - 1 },
      (_, index) => index + 2,
    );
    const otherPages = await Promise.all(pageNumbers.map(getPage));

    return [firstPage, ...otherPages].flatMap((page) => page.data ?? []);
  }

  async loadBreeds() {
    try {
      this.setStatus("Loading breeds...");
      this.toggleControls(false);

      // Groups are optional, so a failure there won't stop the breed list
      const [breeds, groups] = await Promise.all([
        this.fetchAllPages("breeds"),
        this.fetchAllPages("groups").catch((error) => {
          console.warn(error);
          return [];
        }),
      ]);

      groups.forEach((group) => {
        this.groups.set(group.id, group.attributes?.name);
      });

      this.breeds = breeds.sort((a, b) =>
        a.attributes.name.localeCompare(b.attributes.name),
      );

      this.populateBreedSelect();
      this.toggleControls(true);
      this.setStatus("");
    } catch (error) {
      console.error(error);
      this.breedSelect.innerHTML =
        '<option value="">Breeds unavailable</option>';
      this.setStatus(
        "Sorry, the breeds could not be loaded. Please refresh the page to try again.",
        true,
      );
    }
  }

  async loadDogFact() {
    const factElement = document.querySelector("#dogFact");

    try {
      const response = await fetch(`${DOG_API}/facts?limit=1`);
      if (!response.ok) throw new Error("Could not load a dog fact.");

      const data = await response.json();
      factElement.textContent =
        data.data?.[0]?.attributes?.body ??
        "Dogs have about 300 million scent receptors in their noses.";
    } catch (error) {
      console.warn(error);
      factElement.textContent =
        "Dogs have about 300 million scent receptors in their noses.";
    }
  }

  toggleControls(isEnabled) {
    [this.breedSelect, this.breedFilter, this.randomButton].forEach(
      (control) => {
        control.disabled = !isEnabled;
      },
    );
  }

  populateBreedSelect(filterText = "") {
    const search = filterText.trim().toLowerCase();
    const previousValue = this.breedSelect.value;

    const matches = search
      ? this.breeds.filter((breed) =>
          breed.attributes.name.toLowerCase().includes(search),
        )
      : this.breeds;

    const label = search
      ? `${matches.length} match${matches.length === 1 ? "" : "es"}`
      : `Choose a breed (${this.breeds.length})`;

    this.breedSelect.innerHTML = `<option value="">${label}</option>`;

    matches.forEach((breed) => {
      const option = document.createElement("option");
      option.value = breed.id;
      option.textContent = breed.attributes.name;
      this.breedSelect.appendChild(option);
    });

    // Keep the current choice if it still matches, or pick the only match
    if (matches.some((breed) => breed.id === previousValue)) {
      this.breedSelect.value = previousValue;
    } else if (matches.length === 1) {
      this.breedSelect.value = matches[0].id;
    }
  }

  async handleSubmit(event) {
    event.preventDefault();

    const selectedBreedId = this.breedSelect.value;

    if (!selectedBreedId) {
      this.setStatus("Please select a breed.", true);
      this.breedSelect.focus();
      return;
    }

    const breed = this.breeds.find((item) => item.id === selectedBreedId);

    if (!breed) {
      this.setStatus(
        "That breed couldn't be found. Please choose another one.",
        true,
      );
      return;
    }

    await this.showBreed(breed);
  }

  async showRandomBreed() {
    if (!this.breeds.length) return;

    const breed = this.breeds[Math.floor(Math.random() * this.breeds.length)];

    this.breedFilter.value = "";
    this.populateBreedSelect();
    this.breedSelect.value = breed.id;

    await this.showBreed(breed);
  }

  async showBreed(breed) {
    this.setStatus("");
    this.displayBreed(breed);
    this.result.scrollIntoView({ behavior: "smooth", block: "start" });

    await this.loadWikipediaInfo(breed.attributes.name);
  }

  formatRange(range, unit) {
    const min = range?.min;
    const max = range?.max;

    if (min == null && max == null) return "Not available";
    if (min == null || max == null || min === max)
      return `${min ?? max} ${unit}`;

    return `${min} – ${max} ${unit}`;
  }

  // Shows kg with pounds underneath, since many US clinics use pounds
  formatWeight(range) {
    const kg = this.formatRange(range, "kg");
    if (kg === "Not available") return kg;

    const toLb = (value) =>
      value == null ? null : Math.round(value * KG_TO_LB);
    const lb = this.formatRange(
      { min: toLb(range.min), max: toLb(range.max) },
      "lb",
    );

    return `${kg}<span class="sub">${lb}</span>`;
  }

  getSizeCategory(info) {
    const heaviest = Math.max(
      info.male_weight?.max ?? 0,
      info.female_weight?.max ?? 0,
    );

    if (!heaviest) return "Not available";
    if (heaviest < 5) return "Toy";
    if (heaviest < 11) return "Small";
    if (heaviest < 26) return "Medium";
    if (heaviest < 45) return "Large";
    return "Giant";
  }

  displayBreed(breed) {
    const info = breed.attributes;
    const groupId = breed.relationships?.group?.data?.id;
    const groupName = this.groups.get(groupId) ?? "";

    this.result.classList.remove("hidden");

    document.querySelector("#breedName").textContent = info.name;
    document.querySelector("#breedGroup").textContent = groupName;

    document.querySelector("#breedDescription").textContent =
      info.description || "No description available.";

    document.querySelector("#life").textContent = this.formatRange(
      info.life,
      "years",
    );

    // formatWeight returns numbers we built ourselves, so innerHTML is safe here
    document.querySelector("#maleWeight").innerHTML = this.formatWeight(
      info.male_weight,
    );
    document.querySelector("#femaleWeight").innerHTML = this.formatWeight(
      info.female_weight,
    );

    document.querySelector("#size").textContent = this.getSizeCategory(info);
    document.querySelector("#group").textContent = groupName || "Not available";

    document.querySelector("#hypoallergenic").textContent = info.hypoallergenic
      ? "Yes"
      : "No";

    // Reset the photo until Wikipedia answers
    this.setImage(null, info.name);
  }

  setImage(source, breedName) {
    const breedImage = document.querySelector("#breedImage");
    const placeholder = document.querySelector("#imagePlaceholder");

    if (!source) {
      breedImage.classList.add("hidden");
      breedImage.removeAttribute("src");
      placeholder.classList.remove("hidden");
      return;
    }

    breedImage.onerror = () => this.setImage(null, breedName);
    breedImage.src = source;
    breedImage.alt = `${breedName} dog`;
    breedImage.classList.remove("hidden");
    placeholder.classList.add("hidden");
  }

  async loadWikipediaInfo(breedName) {
    const wikiSummary = document.querySelector("#wikiSummary");
    const wikiLink = document.querySelector("#wikiLink");

    // If someone picks another breed before this finishes, ignore the old answer
    const requestId = ++this.wikiRequestId;

    wikiSummary.textContent = "Loading additional information...";
    wikiLink.classList.add("hidden");

    const params = new URLSearchParams({
      action: "query",
      format: "json",
      origin: "*",
      generator: "search",
      gsrsearch: `${breedName} dog breed`,
      gsrlimit: "1",
      prop: "extracts|pageimages|info",
      inprop: "url",
      exintro: "1",
      explaintext: "1",
      exsentences: "3",
      piprop: "thumbnail",
      pithumbsize: "500",
      redirects: "1",
    });

    try {
      const response = await fetch(`${WIKI_API}?${params}`);

      if (!response.ok) {
        throw new Error("Wikipedia request failed.");
      }

      const data = await response.json();
      if (requestId !== this.wikiRequestId) return;

      const pages = data.query?.pages;

      if (!pages) {
        wikiSummary.textContent = "No additional information was found.";
        return;
      }

      const page = Object.values(pages)[0];

      wikiSummary.textContent =
        page.extract || "No additional information available.";

      this.setImage(page.thumbnail?.source, breedName);

      if (page.fullurl) {
        wikiLink.href = page.fullurl;
        wikiLink.classList.remove("hidden");
      }
    } catch (error) {
      console.error(error);
      if (requestId !== this.wikiRequestId) return;

      wikiSummary.textContent =
        "Additional breed information could not be loaded.";
    }
  }
}

new VetBreedApp();
