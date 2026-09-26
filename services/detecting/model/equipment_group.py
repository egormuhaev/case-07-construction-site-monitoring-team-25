from dataclasses import dataclass

PERSON_CODE = "PERSON"


@dataclass(frozen=True)
class EquipmentGroup:
    code: str
    description: str
    prompts: tuple[str, ...]
    normative_groups: tuple[str, ...] = ()


GROUPS: tuple[EquipmentGroup, ...] = (
    EquipmentGroup(
        code="EARTHMOVING",
        description="Землеройная, погрузочная и тракторная техника",
        prompts=(
            "heavy earthmoving construction machine on tracks or large wheels, "
            "with a bucket, blade, articulated boom or soil-moving attachment",
            "excavator, bulldozer, wheel loader, scraper, motor grader or crawler "
            "tractor working with soil on a construction site",
            "large construction vehicle designed for digging, grading, loading or "
            "pushing earth",
        ),
        normative_groups=("91.01", "91.15"),
    ),
    EquipmentGroup(
        code="DRILLING_PILING",
        description="Буровая, свайная и шпунтовая техника",
        prompts=(
            "heavy drilling or piling construction rig with a tall vertical mast, "
            "auger, drill rod or pile hammer",
            "crawler or truck-mounted foundation drilling machine, pile driving rig "
            "or vibratory pile driver",
            "construction machine installing piles or drilling deep holes in the ground",
        ),
        normative_groups=("91.02", "91.04"),
    ),
    EquipmentGroup(
        code="TUNNEL_MINING",
        description="Техника для тоннелей, шахт и подземных работ",
        prompts=(
            "specialized underground mining or tunneling machine inside a tunnel, "
            "mine shaft or underground construction site",
            "tunnel boring machine, roadheader, drilling jumbo, underground loader "
            "or tunnel railway equipment",
            "heavy machine used for excavating, drilling or servicing an underground tunnel",
        ),
        normative_groups=("91.03",),
    ),
    EquipmentGroup(
        code="CRANE_LIFTING",
        description="Краны и крупная подъёмная техника",
        prompts=(
            "construction crane with a long boom, lattice jib, tower, hook, hoist "
            "cables or outriggers",
            "tower crane, mobile truck crane, crawler crane, gantry crane or railway "
            "crane lifting a heavy load",
            "large lifting machine with a boom or overhead girder used on a construction site",
        ),
        normative_groups=("91.05",),
    ),
    EquipmentGroup(
        code="MATERIAL_HANDLING_LIFT",
        description="Подъёмники и оборудование для перемещения материалов",
        prompts=(
            "construction material handling or access equipment, such as a conveyor, "
            "hoist, winch, scissor lift or aerial work platform",
            "machine or mechanism lifting workers or moving construction materials, "
            "with a platform, cage, conveyor belt or cable drum",
            "construction lifting platform, building hoist, aerial lift or material conveyor",
        ),
        normative_groups=("91.06",),
    ),
    EquipmentGroup(
        code="CONCRETE_MORTAR",
        description="Оборудование для бетона, цемента и строительных растворов",
        prompts=(
            "concrete or mortar construction equipment with a mixing drum, hopper, "
            "silo, pump boom, tanks or delivery hoses",
            "concrete mixer, concrete pump, batching plant, cement silo or mortar "
            "processing machine",
            "machine used to mix, pump, spray or place concrete, cement, grout or mortar",
        ),
        normative_groups=("91.07", "91.14"),
    ),
    EquipmentGroup(
        code="ROAD_CONSTRUCTION",
        description="Техника для строительства, ремонта и содержания дорог",
        prompts=(
            "large road construction machine working on pavement, with steel rollers, "
            "paving screed, asphalt hopper, milling conveyor or spraying tank",
            "road roller, asphalt paver, motor grader, cold milling machine or road "
            "maintenance machine",
            "machine used for paving, compacting, milling, surfacing or maintaining a road",
        ),
        normative_groups=("91.08", "91.13"),
    ),
    EquipmentGroup(
        code="RAILWAY",
        description="Железнодорожный транспорт и путевая техника",
        prompts=(
            "railway construction or maintenance machine running on steel rails",
            "locomotive, rail work vehicle, track laying crane, tamping machine or "
            "railway maintenance equipment",
            "specialized heavy machine working on railway tracks, sleepers, ballast "
            "or overhead electrical lines",
        ),
        normative_groups=("91.09",),
    ),
    EquipmentGroup(
        code="PIPELINE_CABLE",
        description="Техника для строительства трубопроводов, кабелей и ЛЭП",
        prompts=(
            "specialized pipeline construction machine working with large pipes, weld "
            "joints, pipe trenches, cable reels or utility lines",
            "pipelayer, pipe coating machine, pipe jacking equipment, cable laying plow "
            "or power line stringing equipment",
            "construction equipment installing, coating, testing, heating or transporting "
            "pipes and cables",
        ),
        normative_groups=("91.10", "91.11"),
    ),
    EquipmentGroup(
        code="AGRICULTURAL_LAND",
        description="Сельскохозяйственная, лесная и мелиоративная техника",
        prompts=(
            "agricultural, forestry or land reclamation machine with plow, discs, "
            "tines, mower, seeder or vegetation cutting attachment",
            "tractor-mounted or towed machine used for cultivating soil, clearing "
            "vegetation, mowing or planting",
            "harrow, plow, cultivator, seeder, stump grinder, mower or forestry machine",
        ),
        normative_groups=("91.12",),
    ),
    EquipmentGroup(
        code="TRUCK_TRANSPORT",
        description="Грузовой и специальный автомобильный транспорт",
        prompts=(
            "heavy construction truck or transport vehicle with a dump body, flatbed, "
            "tank, trailer or cargo platform",
            "dump truck, tractor unit, flatbed truck, tanker truck, pipe carrier or "
            "heavy trailer",
            "large road vehicle used to transport soil, construction materials, pipes, "
            "machinery or liquids",
        ),
        normative_groups=("91.13", "91.14", "91.15"),
    ),
    EquipmentGroup(
        code="POWER_COMPRESSOR_WELDING",
        description="Энергетическое, компрессорное, сварочное и тепловое оборудование",
        prompts=(
            "construction site utility equipment in a metal enclosure, container, skid "
            "or trailer with engine, generator, compressor, cables or hoses",
            "mobile generator, air compressor, welding machine, power station or heat "
            "treatment unit",
            "industrial support machine supplying electrical power, compressed air, "
            "welding current or heat",
        ),
        normative_groups=("91.16", "91.17", "91.18"),
    ),
    EquipmentGroup(
        code="PUMP_FLUID",
        description="Насосы, гидростанции и оборудование для перекачки жидкостей",
        prompts=(
            "industrial pump or pumping station with motor, pipes, tanks, valves and "
            "large suction or discharge hoses",
            "mobile or stationary construction pump, hydraulic power unit or sludge "
            "suction machine",
            "equipment used for pumping water, mud, slurry, oil or hydraulic fluid on "
            "a construction site",
        ),
        normative_groups=("91.19",),
    ),
    EquipmentGroup(
        code="MARINE_FLOATING",
        description="Плавучая строительная техника и рабочие суда",
        prompts=(
            "floating construction equipment, work vessel, barge or pontoon operating "
            "on water",
            "dredger, floating crane, pile driving barge, pumping pontoon, tugboat or "
            "floating work platform",
            "marine construction machine mounted on a vessel, barge, pontoon or "
            "floating platform",
        ),
        normative_groups=("91.20",),
    ),
    EquipmentGroup(
        code="SMALL_TOOLS_PROCESSING",
        description="Механизированный инструмент и компактное оборудование",
        prompts=(
            "small construction power tool or compact walk-behind machine used by a "
            "worker for cutting, drilling, grinding, demolition or cleaning",
            "jackhammer, concrete saw, grinder, pressure washer, sandblaster, drill, "
            "press or workshop machine",
            "portable or compact powered construction equipment, not a heavy vehicle",
        ),
        normative_groups=("91.21",),
    ),
    EquipmentGroup(
        code="UNKNOWN_EQUIPMENT",
        description="Неопознанная техника",
        prompts=(
            "unidentified construction machinery or industrial equipment that does "
            "not clearly belong to any known equipment category",
        ),
    ),
)

GROUP_BY_CODE = {group.code: group for group in GROUPS}
UNKNOWN_EQUIPMENT_CODE = GROUP_BY_CODE["UNKNOWN_EQUIPMENT"].code
