#!/usr/bin/env python3
"""Russian display names for the bundled offline settlement catalogue.

GeoNames contains names in local scripts and many Latin transliterations.  The
runtime map is Russian-only, so this module keeps known Russian exonyms and uses
country-aware transcription as an offline fallback for small settlements that
do not have a Russian alternate name in the source snapshot.
"""

from __future__ import annotations

import re
import unicodedata

RUSSIAN_LETTER_RE = re.compile(r"[А-Яа-яЁё]")
LATIN_OR_GREEK_RE = re.compile(r"[A-Za-zÀ-žΑ-ωΆ-ώ]")
WORD_RE = re.compile(r"[^\W\d_]+", re.UNICODE)
ROMAN_RE = re.compile(r"\b[IVXLCDM]+\b")


def _plain(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value.casefold())
    normalized = normalized.translate(str.maketrans({
        "ł": "l", "ø": "o", "đ": "d", "ð": "d", "þ": "th",
        "ı": "i", "æ": "ae", "œ": "oe",
    }))
    return "".join(character for character in normalized if not unicodedata.combining(character))


def _override_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", _plain(value)).strip()


# Conventional Russian forms for prominent labels and names visible in the
# Moldova / Ukraine / Romania working area. Keys are accent-insensitive.
EXACT_NAMES: dict[tuple[str, str], str] = {
    ("UA", "novyi krym"): "Новый Крым",
    ("UA", "novyy krym"): "Новый Крым",
    ("UA", "staryi krym"): "Старый Крым",
    ("UA", "staryy krym"): "Старый Крым",
    ("MD", "balti"): "Бельцы",
    ("MD", "basarabeasca"): "Бессарабка",
    ("MD", "briceni"): "Бричаны",
    ("MD", "cahul"): "Кагул",
    ("MD", "calarasi"): "Калараш",
    ("MD", "causeni"): "Каушаны",
    ("MD", "ceadir lunga"): "Чадыр-Лунга",
    ("MD", "chisinau"): "Кишинёв",
    ("MD", "cimislia"): "Чимишлия",
    ("MD", "comrat"): "Комрат",
    ("MD", "donduseni"): "Дондюшаны",
    ("MD", "drochia"): "Дрокия",
    ("MD", "dubasari"): "Дубоссары",
    ("MD", "edinet"): "Единцы",
    ("MD", "falesti"): "Фалешты",
    ("MD", "floresti"): "Флорешты",
    ("MD", "hincesti"): "Хынчешты",
    ("MD", "ialoveni"): "Яловены",
    ("MD", "leova"): "Леова",
    ("MD", "nisporeni"): "Ниспорены",
    ("MD", "ocnita"): "Окница",
    ("MD", "orhei"): "Оргеев",
    ("MD", "rezina"): "Резина",
    ("MD", "ribnita"): "Рыбница",
    ("MD", "riscani"): "Рышканы",
    ("MD", "sangerei"): "Сынжерей",
    ("MD", "soroca"): "Сороки",
    ("MD", "stefan voda"): "Штефан-Водэ",
    ("MD", "straseni"): "Страшены",
    ("MD", "taraclia"): "Тараклия",
    ("MD", "tiraspol"): "Тирасполь",
    ("MD", "ungheni"): "Унгены",
    ("RO", "alba iulia"): "Алба-Юлия",
    ("RO", "arad"): "Арад",
    ("RO", "bacau"): "Бакэу",
    ("RO", "baia mare"): "Бая-Маре",
    ("RO", "bailesti"): "Бэйлешти",
    ("RO", "bistrita"): "Бистрица",
    ("RO", "botosani"): "Ботошани",
    ("RO", "braila"): "Брэила",
    ("RO", "brasov"): "Брашов",
    ("RO", "buhusi"): "Бухуши",
    ("RO", "buzau"): "Бузэу",
    ("RO", "calarasi"): "Кэлэраши",
    ("RO", "cluj napoca"): "Клуж-Напока",
    ("RO", "constanta"): "Констанца",
    ("RO", "craiova"): "Крайова",
    ("RO", "dej"): "Деж",
    ("RO", "deva"): "Дева",
    ("RO", "dorohoi"): "Дорохой",
    ("RO", "drobeta turnu severin"): "Дробета-Турну-Северин",
    ("RO", "focsani"): "Фокшаны",
    ("RO", "galati"): "Галац",
    ("RO", "gheorgheni"): "Георгени",
    ("RO", "harlau"): "Хырлэу",
    ("RO", "husi"): "Хуши",
    ("RO", "hunedoara"): "Хунедоара",
    ("RO", "iasi"): "Яссы",
    ("RO", "mangalia"): "Мангалия",
    ("RO", "medgidia"): "Меджидия",
    ("RO", "medias"): "Медиаш",
    ("RO", "miercurea ciuc"): "Меркуря-Чук",
    ("RO", "oradea"): "Орадя",
    ("RO", "pascani"): "Пашкани",
    ("RO", "petrosani"): "Петрошани",
    ("RO", "piatra neamt"): "Пьятра-Нямц",
    ("RO", "pitesti"): "Питешти",
    ("RO", "ploiesti"): "Плоешти",
    ("RO", "ramnicu sarat"): "Рымнику-Сэрат",
    ("RO", "rosiorii de vede"): "Рошиорий-де-Веде",
    ("RO", "satu mare"): "Сату-Маре",
    ("RO", "sfantu gheorghe"): "Сфынту-Георге",
    ("RO", "sighetu marmatiei"): "Сигету-Мармацией",
    ("RO", "sighisoara"): "Сигишоара",
    ("RO", "sibiu"): "Сибиу",
    ("RO", "slobozia"): "Слобозия",
    ("RO", "suceava"): "Сучава",
    ("RO", "targu jiu"): "Тыргу-Жиу",
    ("RO", "targu mures"): "Тыргу-Муреш",
    ("RO", "targu neamt"): "Тыргу-Нямц",
    ("RO", "targu ocna"): "Тыргу-Окна",
    ("RO", "targu secuiesc"): "Тыргу-Секуйеск",
    ("RO", "tecuci"): "Текуч",
    ("RO", "timisoara"): "Тимишоара",
    ("RO", "tulcea"): "Тулча",
    ("PL", "nowy sacz"): "Новы-Сонч",
    ("PL", "nowy targ"): "Новы-Тарг",
    ("PL", "biala podlaska"): "Бяла-Подляска",
    ("ME", "herceg novi"): "Херцег-Нови",
}

CYRILLIC_EXACT_NAMES: dict[tuple[str, str], str] = {
    ("PL", "Новий Тарг"): "Новы-Тарг",
    ("PL", "Новий Сонч"): "Новы-Сонч",
    ("PL", "Новий Томишль"): "Новы-Томысль",
    ("PL", "Новий Став"): "Новы-Став",
    ("ME", "Херцег-Новий"): "Херцег-Нови",
    ("HR", "Старий Град"): "Стари-Град",
}

CYRILLIC_NORMALIZATION = str.maketrans({
    "І": "И", "і": "и", "Ї": "Йи", "ї": "йи", "Є": "Е", "є": "е",
    "Ґ": "Г", "ґ": "г", "Ў": "У", "ў": "у", "Ј": "Й", "ј": "й",
    "Љ": "Ль", "љ": "ль", "Њ": "Нь", "њ": "нь", "Ћ": "Ч", "ћ": "ч",
    "Ќ": "К", "ќ": "к", "Ђ": "Дж", "ђ": "дж", "Ѓ": "Г", "ѓ": "г",
    "Џ": "Дж", "џ": "дж", "Ѕ": "Дз", "ѕ": "дз",
})

UA_WORDS = {
    "новий": "новый",
    "старий": "старый",
    "малий": "малый",
    "кленовий": "кленовый",
    "крим": "крым",
    "кримка": "крымка",
    "нове": "новое",
    "старе": "старое",
    "перше": "первое",
    "друге": "второе",
}

GREEK_MAP = {
    "α": "а", "β": "в", "γ": "г", "δ": "д", "ε": "е", "ζ": "з",
    "η": "и", "θ": "т", "ι": "и", "κ": "к", "λ": "л", "μ": "м",
    "ν": "н", "ξ": "кс", "ο": "о", "π": "п", "ρ": "р", "σ": "с",
    "ς": "с", "τ": "т", "υ": "и", "φ": "ф", "χ": "х", "ψ": "пс",
    "ω": "о",
}

BASIC_LATIN = {
    "a": "а", "b": "б", "c": "к", "d": "д", "e": "е", "f": "ф",
    "g": "г", "h": "х", "i": "и", "j": "й", "k": "к", "l": "л",
    "m": "м", "n": "н", "o": "о", "p": "п", "q": "к", "r": "р",
    "s": "с", "t": "т", "u": "у", "v": "в", "w": "в", "x": "кс",
    "y": "ы", "z": "з", "æ": "э", "œ": "ё", "ø": "ё", "ı": "ы",
    "ð": "д", "þ": "т",
}

COMMON_PATTERNS = [
    ("shch", "щ"), ("sch", "щ"), ("dzh", "дж"), ("dz", "дз"),
    ("zh", "ж"), ("kh", "х"), ("ch", "ч"), ("sh", "ш"),
    ("tch", "ч"), ("ts", "ц"), ("ya", "я"), ("yu", "ю"),
    ("yo", "ё"), ("ye", "е"), ("ph", "ф"), ("th", "т"),
    ("ck", "к"), ("qu", "кв"),
]

COUNTRY_PATTERNS: dict[str, list[tuple[str, str]]] = {
    "RO": [
        ("ghea", "гя"), ("ghe", "ге"), ("ghi", "ги"),
        ("che", "ке"), ("chi", "ки"), ("gea", "джа"),
        ("giu", "джу"), ("ge", "дже"), ("gi", "джи"),
        ("cea", "ча"), ("ciu", "чу"), ("ce", "че"), ("ci", "чи"),
        ("ș", "ш"), ("ş", "ш"), ("ț", "ц"), ("ţ", "ц"),
        ("ă", "э"), ("â", "ы"), ("î", "ы"), ("j", "ж"),
        ("c", "к"), ("h", "х"),
    ],
    "PL": [
        ("dź", "дзь"), ("dż", "дж"), ("dzi", "дзи"),
        ("cz", "ч"), ("sz", "ш"), ("rz", "ж"), ("ch", "х"),
        ("ci", "чи"), ("si", "ши"), ("zi", "жи"), ("ni", "ни"),
        ("ą", "он"), ("ę", "ен"), ("ł", "л"), ("ń", "нь"),
        ("ś", "сь"), ("ć", "ць"), ("ź", "зь"), ("ż", "ж"),
        ("w", "в"), ("j", "й"), ("y", "ы"), ("c", "ц"),
    ],
    "CZ": [
        ("ch", "х"), ("ř", "рж"), ("č", "ч"), ("š", "ш"),
        ("ž", "ж"), ("ď", "дь"), ("ť", "ть"), ("ň", "нь"),
        ("ě", "е"), ("ů", "у"), ("j", "й"), ("c", "ц"),
        ("h", "г"), ("y", "ы"),
    ],
    "SK": [
        ("ch", "х"), ("dž", "дж"), ("č", "ч"), ("š", "ш"),
        ("ž", "ж"), ("ď", "дь"), ("ť", "ть"), ("ň", "нь"),
        ("ľ", "ль"), ("ĺ", "л"), ("ô", "о"), ("j", "й"),
        ("c", "ц"), ("h", "г"), ("y", "ы"),
    ],
    "HU": [
        ("dzs", "дж"), ("sz", "с"), ("cs", "ч"), ("zs", "ж"),
        ("gy", "дь"), ("ny", "нь"), ("ty", "ть"), ("ly", "й"),
        ("s", "ш"), ("j", "й"), ("ö", "ё"), ("ő", "ё"),
        ("ü", "ю"), ("ű", "ю"), ("c", "ц"),
    ],
    "TR": [
        ("ş", "ш"), ("ș", "ш"), ("ç", "ч"), ("ğ", "г"),
        ("ı", "ы"), ("ö", "ё"), ("ü", "ю"), ("c", "дж"),
        ("j", "ж"), ("y", "й"), ("h", "х"),
    ],
    "AZ": [
        ("ş", "ш"), ("ç", "ч"), ("ğ", "г"), ("ı", "ы"),
        ("ö", "ё"), ("ü", "ю"), ("ə", "э"), ("x", "х"),
        ("q", "г"), ("c", "дж"), ("j", "ж"), ("y", "й"),
    ],
    "DE": [
        ("tsch", "ч"), ("sch", "ш"), ("ch", "х"), ("z", "ц"),
        ("w", "в"), ("j", "й"), ("ä", "э"), ("ö", "ё"),
        ("ü", "ю"), ("ß", "с"),
    ],
    "AT": [
        ("tsch", "ч"), ("sch", "ш"), ("ch", "х"), ("z", "ц"),
        ("w", "в"), ("j", "й"), ("ä", "э"), ("ö", "ё"),
        ("ü", "ю"), ("ß", "с"),
    ],
    "IT": [
        ("gli", "льи"), ("gn", "нь"), ("chi", "ки"), ("che", "ке"),
        ("ghi", "ги"), ("ghe", "ге"), ("ci", "чи"), ("ce", "че"),
        ("gi", "джи"), ("ge", "дже"), ("sc", "ш"), ("c", "к"),
    ],
    "HR": [("dž", "дж"), ("lj", "ль"), ("nj", "нь"), ("đ", "дж"), ("č", "ч"), ("ć", "ч"), ("š", "ш"), ("ž", "ж"), ("j", "й"), ("c", "ц")],
    "RS": [("dž", "дж"), ("lj", "ль"), ("nj", "нь"), ("đ", "дж"), ("č", "ч"), ("ć", "ч"), ("š", "ш"), ("ž", "ж"), ("j", "й"), ("c", "ц")],
    "BA": [("dž", "дж"), ("lj", "ль"), ("nj", "нь"), ("đ", "дж"), ("č", "ч"), ("ć", "ч"), ("š", "ш"), ("ž", "ж"), ("j", "й"), ("c", "ц")],
    "ME": [("dž", "дж"), ("lj", "ль"), ("nj", "нь"), ("đ", "дж"), ("č", "ч"), ("ć", "ч"), ("š", "ш"), ("ž", "ж"), ("j", "й"), ("c", "ц")],
    "SI": [("lj", "ль"), ("nj", "нь"), ("č", "ч"), ("š", "ш"), ("ž", "ж"), ("j", "й"), ("c", "ц")],
    "LT": [("č", "ч"), ("š", "ш"), ("ž", "ж"), ("j", "й"), ("c", "ц")],
    "LV": [("č", "ч"), ("š", "ш"), ("ž", "ж"), ("ģ", "г"), ("ķ", "к"), ("ļ", "ль"), ("ņ", "нь"), ("j", "й"), ("c", "ц")],
    "EE": [("š", "ш"), ("ž", "ж"), ("j", "й"), ("õ", "ы"), ("ä", "я"), ("ö", "ё"), ("ü", "ю")],
    "FI": [("sh", "ш"), ("j", "й"), ("y", "ю"), ("ä", "я"), ("ö", "ё")],
    "SE": [("skj", "ш"), ("sj", "ш"), ("kj", "ч"), ("j", "й"), ("å", "о"), ("ä", "э"), ("ö", "ё")],
}

# ISO codes whose GeoNames source commonly uses an English/Ukrainian-style
# transliteration. Longest sequences are replaced first.
EAST_SLAVIC_CODES = {"UA", "BY", "RU", "KZ", "UZ", "TM", "AM", "GE"}
EAST_SLAVIC_PATTERNS = [
    ("shch", "щ"), ("dzh", "дж"), ("zh", "ж"), ("kh", "х"),
    ("ch", "ч"), ("sh", "ш"), ("ts", "ц"), ("ya", "я"),
    ("yu", "ю"), ("yo", "ё"), ("ye", "е"),
]

UA_LATIN_WORDS = {
    "novyi": "новый", "novyy": "новый", "staryi": "старый", "staryy": "старый",
    "malyi": "малый", "malyy": "малый", "velykyi": "великий", "verkhnii": "верхний",
    "nyzhnii": "нижний", "krym": "крым", "krymu": "крыму", "nove": "новое",
    "stare": "старое", "pershe": "первое", "druhe": "второе",
}


def _roman_to_number(token: re.Match[str]) -> str:
    values = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100, "D": 500, "M": 1000}
    text = token.group(0)
    total = 0
    previous = 0
    for character in reversed(text):
        value = values[character]
        if value < previous:
            total -= value
        else:
            total += value
            previous = value
    return str(total)


def _replace_patterns(value: str, patterns: list[tuple[str, str]]) -> str:
    for source, target in sorted(patterns, key=lambda entry: len(entry[0]), reverse=True):
        value = value.replace(source, target)
    return value


def _transliterate_word(word: str, country: str) -> str:
    source = unicodedata.normalize("NFC", word)
    lowered = source.casefold()
    if country == "UA" and lowered in UA_LATIN_WORDS:
        result = UA_LATIN_WORDS[lowered]
    else:
        patterns = COUNTRY_PATTERNS.get(country, [])
        if country in EAST_SLAVIC_CODES:
            patterns = [*patterns, *EAST_SLAVIC_PATTERNS]
        result = _replace_patterns(lowered, patterns)
        result = _replace_patterns(result, COMMON_PATTERNS)

        output: list[str] = []
        for character in result:
            if "а" <= character <= "я" or character == "ё":
                output.append(character)
                continue
            if character in GREEK_MAP:
                output.append(GREEK_MAP[character])
                continue
            if character in BASIC_LATIN:
                output.append(BASIC_LATIN[character])
                continue
            decomposed = unicodedata.normalize("NFKD", character)
            base = next((part.casefold() for part in decomposed if not unicodedata.combining(part)), "")
            if base in BASIC_LATIN:
                output.append(BASIC_LATIN[base])
            elif base in GREEK_MAP:
                output.append(GREEK_MAP[base])
            else:
                output.append(character)
        result = "".join(output)

    if country == "UA":
        result = re.sub(r"цкыи$", "цкий", result)
        result = re.sub(r"скыи$", "ский", result)
        result = re.sub(r"ныи$", "ный", result)
        result = re.sub(r"ыи$", "ый", result)
        result = re.sub(r"ове$", "ово", result)
        result = re.sub(r"еве$", "ево", result)
        result = re.sub(r"ивка$", "овка", result)
        result = re.sub(r"ивци$", "овцы", result)

    if source[:1].isupper() and result:
        result = result[:1].upper() + result[1:]
    return result


def _replace_ua_word(match: re.Match[str]) -> str:
    source = match.group(0)
    replacement = UA_WORDS.get(source.casefold(), source.casefold())
    return replacement[:1].upper() + replacement[1:] if source[:1].isupper() else replacement


def russianize_name(name: str, country: str = "") -> str:
    """Return a Russian/Cyrillic display name without network lookups."""
    value = unicodedata.normalize("NFC", str(name)).strip()
    if not value:
        return value

    country = country.upper()
    override = EXACT_NAMES.get((country, _override_key(value)))
    if override:
        return override

    value = value.translate(CYRILLIC_NORMALIZATION)
    value = CYRILLIC_EXACT_NAMES.get((country, value), value)
    if country == "UA":
        value = WORD_RE.sub(_replace_ua_word, value)

    value = ROMAN_RE.sub(_roman_to_number, value)
    value = WORD_RE.sub(lambda match: _transliterate_word(match.group(0), country), value)
    value = value.translate(CYRILLIC_NORMALIZATION)
    value = re.sub(r"\s*-\s*", "-", value)
    value = re.sub(r"\s+", " ", value).strip(" ,")

    # Last-resort conversion for an unusual decomposed Latin/Greek character.
    if LATIN_OR_GREEK_RE.search(value):
        value = WORD_RE.sub(lambda match: _transliterate_word(match.group(0), country), value)
    return value


def is_russian_display_name(value: str) -> bool:
    """True when every alphabetic character belongs to the Russian alphabet."""
    for character in value:
        if not character.isalpha():
            continue
        lowered = character.casefold()
        if lowered != "ё" and not ("а" <= lowered <= "я"):
            return False
    return True
